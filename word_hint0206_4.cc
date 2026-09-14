#include <napi.h>


#include <iostream>
#include <algorithm>
#include <cerrno>
#include <cstdio>
#include <cstring>
#include <queue>
#include <stdexcept>


#include "./word_hint0206/solver4.hpp"
#include "./word_hint0206/helper.hpp"



// 参数一：文本
// 参数二：方案文件名(不带扩展名)
// 返回值：……
Napi::Object word_hint_solve(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    
    try {
        Solve solver;
        std::string text = info[0].As<Napi::String>().Utf8Value();
        std::string type = info[1].As<Napi::String>().Utf8Value();

        std::string type_hint = type + ".hint";
        std::string type_config = type + ".config";

        if (!solver.data.load_hint(type_hint)) {
            Napi::Error::New(env, std::string("方案文件\"") + type +
                                      std::string(".hint\"不存在"))
                .ThrowAsJavaScriptException();
            return env.Null().As<Napi::Object>();
        }

        if (!solver.data.load_config(type_config)) {
            Napi::Error::New(env, std::string("方案文件\"") + type +
                                      std::string(".config\"不存在"))
                .ThrowAsJavaScriptException();
            return env.Null().As<Napi::Object>();
        }

        std::u32string u32_text = to_utf32(text);

        Answer ans = solver.solve(u32_text);

        Napi::Object ret = Napi::Object::New(env);
        Napi::Object ret_show_list = Napi::Array::New(env, ans.ans.size());
        ret.Set(Napi::String::New(env, "code_len"), ans.code_len);
        ret.Set(Napi::String::New(env, "num_of_candidate"), ans.chongshu);
        ret.Set(Napi::String::New(env, "num_of_char"), u32_text.size());
        ret.Set(Napi::String::New(env, "num_of_que"), ans.queshu);

        for (int i = 0; i < ans.ans.size(); i++) {
            const auto& it = ans.ans[i];
            Napi::Object show = Napi::Object::New(env);
            show.Set(Napi::String::New(env, "code"), to_utf8(it.code));
            show.Set(Napi::String::New(env, "word"), to_utf8(it.word));
            show.Set(Napi::String::New(env, "type"), it.type);
            show.Set(Napi::String::New(env, "is_chong"), (bool)it.is_chong);
            show.Set(Napi::String::New(env, "is_que"), (bool)it.is_que);
            ret_show_list.Set(i, show);
        }

        ret.Set(Napi::String::New(env, "show_list"), ret_show_list);
        solver.data.unload_hint();
        return ret;
    } catch (std::exception e) {
        std::cout << e.what() << '\n';
        Napi::Error::New(env, "词提文件出现错误").ThrowAsJavaScriptException();
        return env.Null().As<Napi::Object>();
    }
}

// 参数一：方案文件名(不带扩展名)
char buf[1 << 20];

namespace {
constexpr size_t kSortRunBudget = 4 * 1024 * 1024;

struct TempFiles {
    std::vector<std::string> paths;
    ~TempFiles() {
        for (const auto& path : paths) unlink(path.c_str());
    }
};

std::pair<FILE*, std::string> make_temp_file(const std::string& pattern) {
    std::string path = pattern;
    int fd = mkstemp(&path[0]);
    if (fd == -1) throw std::runtime_error("cannot create temporary file");
    FILE* fp = fdopen(fd, "w+b");
    if (!fp) {
        close(fd);
        unlink(path.c_str());
        throw std::runtime_error("cannot open temporary file");
    }
    return {fp, path};
}

void write_run_record(FILE* fp, const Pair& pair) {
    uint32_t code_size = pair.code.size();
    uint32_t word_size = pair.word.size();
    if (fwrite(&code_size, sizeof(code_size), 1, fp) != 1 ||
        fwrite(pair.code.data(), sizeof(char32_t), code_size, fp) != code_size ||
        fwrite(&pair.pos, sizeof(pair.pos), 1, fp) != 1 ||
        fwrite(&word_size, sizeof(word_size), 1, fp) != 1 ||
        fwrite(pair.word.data(), sizeof(char32_t), word_size, fp) != word_size)
        throw std::runtime_error("cannot write sort run");
}

bool read_run_record(FILE* fp, Pair& pair) {
    uint32_t code_size, word_size;
    if (fread(&code_size, sizeof(code_size), 1, fp) != 1) {
        if (feof(fp)) return false;
        throw std::runtime_error("cannot read sort run");
    }
    pair.code.resize(code_size);
    if (fread(pair.code.data(), sizeof(char32_t), code_size, fp) != code_size ||
        fread(&pair.pos, sizeof(pair.pos), 1, fp) != 1 ||
        fread(&word_size, sizeof(word_size), 1, fp) != 1)
        throw std::runtime_error("corrupt sort run");
    pair.word.resize(word_size);
    if (fread(pair.word.data(), sizeof(char32_t), word_size, fp) != word_size)
        throw std::runtime_error("corrupt sort run");
    return true;
}

size_t pair_memory(const Pair& pair) {
    return sizeof(Pair) + sizeof(char32_t) * (pair.code.size() + pair.word.size());
}

void flush_sort_run(std::vector<Pair>& records, TempFiles& temp_files,
                    const std::string& base_path) {
    if (records.empty()) return;
    std::sort(records.begin(), records.end());
    auto [fp, filename] = make_temp_file(base_path + ".sort.XXXXXX");
    temp_files.paths.push_back(filename);
    bool open = true;
    try {
        for (const auto& pair : records) write_run_record(fp, pair);
        if (fclose(fp) != 0) {
            open = false;
            throw std::runtime_error("cannot close sort run");
        }
        open = false;
    } catch (...) {
        if (open) fclose(fp);
        throw;
    }
    records.clear();
}

struct RunCursor {
    FILE* fp = nullptr;
    Pair pair;
    size_t run = 0;
};

struct RunCursorGreater {
    bool operator()(const RunCursor& lhs, const RunCursor& rhs) const {
        return rhs.pair < lhs.pair;
    }
};

void close_all_runs(std::vector<FILE*>& runs) {
    for (FILE* fp : runs) {
        if (fp) fclose(fp);
    }
}

#if 0  // Superseded disk-backed builder; retained temporarily for reference.
class SqliteDb {
   public:
    explicit SqliteDb(const std::string& filename) {
        if (sqlite3_open_v2(filename.c_str(), &db_, SQLITE_OPEN_READWRITE |
            SQLITE_OPEN_CREATE, nullptr) != SQLITE_OK)
            throw std::runtime_error("cannot create trie index");
        exec("PRAGMA journal_mode=OFF; PRAGMA synchronous=OFF; "
             "PRAGMA temp_store=FILE; PRAGMA cache_size=-65536;");
    }
    ~SqliteDb() { if (db_) sqlite3_close(db_); }
    sqlite3* get() const { return db_; }
    void exec(const char* sql) {
        char* error = nullptr;
        if (sqlite3_exec(db_, sql, nullptr, nullptr, &error) != SQLITE_OK) {
            std::string message = error ? error : "sqlite error";
            sqlite3_free(error);
            throw std::runtime_error(message);
        }
    }
    sqlite3_stmt* prepare(const char* sql) {
        sqlite3_stmt* stmt = nullptr;
        if (sqlite3_prepare_v2(db_, sql, -1, &stmt, nullptr) != SQLITE_OK)
            throw std::runtime_error(sqlite3_errmsg(db_));
        return stmt;
    }
    void step_done(sqlite3_stmt* stmt) {
        if (sqlite3_step(stmt) != SQLITE_DONE)
            throw std::runtime_error(sqlite3_errmsg(db_));
        sqlite3_reset(stmt); sqlite3_clear_bindings(stmt);
    }
   private:
    sqlite3* db_ = nullptr;
};

struct Statement {
    sqlite3_stmt* stmt = nullptr;
    Statement(SqliteDb& db, const char* sql) : stmt(db.prepare(sql)) {}
    ~Statement() { if (stmt) sqlite3_finalize(stmt); }
    Statement(const Statement&) = delete;
};

class DiskNodeInserter {
   public:
    DiskNodeInserter(SqliteDb& db, const char* table)
        : db_(db), insert_(db, (std::string("INSERT OR IGNORE INTO ") + table +
              "(parent,ch,len) VALUES(?,?,?)").c_str()),
          select_(db, (std::string("SELECT id FROM ") + table +
              " WHERE parent=? AND ch=?").c_str()) {}
    int ensure(int parent, char32_t ch, int len) {
        sqlite3_bind_int(insert_.stmt, 1, parent);
        sqlite3_bind_int(insert_.stmt, 2, static_cast<int>(ch));
        sqlite3_bind_int(insert_.stmt, 3, len);
        db_.step_done(insert_.stmt);
        sqlite3_bind_int(select_.stmt, 1, parent);
        sqlite3_bind_int(select_.stmt, 2, static_cast<int>(ch));
        if (sqlite3_step(select_.stmt) != SQLITE_ROW)
            throw std::runtime_error("missing disk trie node");
        int id = sqlite3_column_int(select_.stmt, 0);
        sqlite3_reset(select_.stmt); sqlite3_clear_bindings(select_.stmt);
        return id;
    }
   private:
    SqliteDb& db_;
    Statement insert_, select_;
};

int scalar_int(SqliteDb& db, sqlite3_stmt* stmt, int value) {
    if (sqlite3_bind_parameter_count(stmt)) sqlite3_bind_int(stmt, 1, value);
    if (sqlite3_step(stmt) != SQLITE_ROW) throw std::runtime_error("sqlite scalar failed");
    int result = sqlite3_column_int(stmt, 0);
    sqlite3_reset(stmt); sqlite3_clear_bindings(stmt);
    return result;
}

size_t disk_node_size(SqliteDb& db, sqlite3_stmt* children,
                      sqlite3_stmt* terms, int id, bool word) {
    int child_count = scalar_int(db, children, id);
    int term_count = scalar_int(db, terms, id);
    return sizeof(int) * ((word ? 7 : 6) + 2 * child_count +
                          (word ? 2 : 1) * term_count);
}

void write_disk_hint(SqliteDb& db, const std::string& filename,
                     const Config& config) {
    Statement code_count(db, "SELECT count(*) FROM code_nodes WHERE parent=?");
    Statement word_count(db, "SELECT count(*) FROM word_nodes WHERE parent=?");
    Statement code_terms(db, "SELECT count(*) FROM code_words WHERE code_id=?");
    Statement word_terms(db, "SELECT count(*) FROM word_codes WHERE word_id=?");
    Statement code_max(db, "SELECT COALESCE(max(id),0)+1 FROM code_nodes");
    Statement word_max(db, "SELECT COALESCE(max(id),0)+1 FROM word_nodes");
    int code_nodes = scalar_int(db, code_max.stmt, 0);
    int word_nodes = scalar_int(db, word_max.stmt, 0);
    size_t code_size = sizeof(long long) * code_nodes;
    size_t word_size = sizeof(long long) * word_nodes;
    for (int id = 0; id < code_nodes; ++id)
        code_size += disk_node_size(db, code_count.stmt, code_terms.stmt, id, false);
    for (int id = 0; id < word_nodes; ++id)
        word_size += disk_node_size(db, word_count.stmt, word_terms.stmt, id, true);

    auto [fp, temporary] = make_temp_file(filename + ".tmp.XXXXXX");
    bool fp_open = true;
    try {
        BufferedFileWriter out(fp);
        long long code_offset = sizeof(long long) * 2;
        long long word_offset = code_offset + code_size;
        out.write_pod(code_offset); out.write_pod(word_offset);
        size_t offset = sizeof(long long) * code_nodes;
        for (int id = 0; id < code_nodes; ++id) {
            long long at = offset; out.write_pod(at);
            offset += disk_node_size(db, code_count.stmt, code_terms.stmt, id, false);
        }

        Statement code_node(db, "SELECT parent,ch,num,sum FROM code_nodes WHERE id=?");
        Statement word_node(db, "SELECT parent,ch,fail,last,len FROM word_nodes WHERE id=?");
        Statement code_children(db, "SELECT ch,id FROM code_nodes WHERE parent=? ORDER BY ch");
        Statement word_children(db, "SELECT ch,id FROM word_nodes WHERE parent=? ORDER BY ch");
        Statement code_word_ids(db, "SELECT word_id FROM code_words WHERE code_id=? ORDER BY pos");
        Statement word_codes(db, "SELECT wc.code_id,wc.idx FROM word_codes wc JOIN codes c ON c.code_id=wc.code_id WHERE wc.word_id=? ORDER BY c.char_len,c.sort_value,wc.pos");
        auto write_children = [&](sqlite3_stmt* stmt, int id) {
            int count = 0;
            sqlite3_bind_int(stmt, 1, id);
            while (sqlite3_step(stmt) == SQLITE_ROW) ++count;
            sqlite3_reset(stmt); sqlite3_clear_bindings(stmt);
            out.write_pod(count);
            sqlite3_bind_int(stmt, 1, id);
            while (sqlite3_step(stmt) == SQLITE_ROW) { char32_t ch=sqlite3_column_int(stmt,0); out.write_pod(ch); }
            sqlite3_reset(stmt); sqlite3_clear_bindings(stmt);
            sqlite3_bind_int(stmt, 1, id);
            while (sqlite3_step(stmt) == SQLITE_ROW) out.write_pod(sqlite3_column_int(stmt,1));
            sqlite3_reset(stmt); sqlite3_clear_bindings(stmt);
        };
        for (int id = 0; id < code_nodes; ++id) {
            sqlite3_bind_int(code_node.stmt, 1, id);
            if (sqlite3_step(code_node.stmt) != SQLITE_ROW) throw std::runtime_error("missing code node");
            int parent=sqlite3_column_int(code_node.stmt,0), ch=sqlite3_column_int(code_node.stmt,1), num=sqlite3_column_int(code_node.stmt,2), sum=sqlite3_column_int(code_node.stmt,3); if(id==0) parent=0;
            sqlite3_reset(code_node.stmt); sqlite3_clear_bindings(code_node.stmt);
            write_children(code_children.stmt, id); out.write_pod(parent); char32_t c=ch; out.write_pod(c); out.write_pod(num); out.write_pod(sum);
            int count=scalar_int(db,code_terms.stmt,id); out.write_pod(count); sqlite3_bind_int(code_word_ids.stmt,1,id); while(sqlite3_step(code_word_ids.stmt)==SQLITE_ROW) out.write_pod(sqlite3_column_int(code_word_ids.stmt,0)); sqlite3_reset(code_word_ids.stmt); sqlite3_clear_bindings(code_word_ids.stmt);
        }
        offset = sizeof(long long) * word_nodes;
        for (int id = 0; id < word_nodes; ++id) {
            long long at = offset; out.write_pod(at);
            offset += disk_node_size(db, word_count.stmt, word_terms.stmt, id, true);
        }
        for (int id = 0; id < word_nodes; ++id) {
            sqlite3_bind_int(word_node.stmt, 1, id);
            if (sqlite3_step(word_node.stmt) != SQLITE_ROW) throw std::runtime_error("missing word node");
            int parent=sqlite3_column_int(word_node.stmt,0), ch=sqlite3_column_int(word_node.stmt,1), fail=sqlite3_column_int(word_node.stmt,2), last=sqlite3_column_int(word_node.stmt,3), len=sqlite3_column_int(word_node.stmt,4); if(id==0) parent=0;
            sqlite3_reset(word_node.stmt); sqlite3_clear_bindings(word_node.stmt);
            write_children(word_children.stmt,id); out.write_pod(parent); char32_t c=ch; out.write_pod(c); out.write_pod(fail); out.write_pod(last); out.write_pod(len);
            int count=scalar_int(db,word_terms.stmt,id); out.write_pod(count); sqlite3_bind_int(word_codes.stmt,1,id); while(sqlite3_step(word_codes.stmt)==SQLITE_ROW){out.write_pod(sqlite3_column_int(word_codes.stmt,0));out.write_pod(sqlite3_column_int(word_codes.stmt,1));} sqlite3_reset(word_codes.stmt); sqlite3_clear_bindings(word_codes.stmt);
        }
        if (!out.flush()) throw std::runtime_error("cannot write hint");
        int close_status = fclose(fp); fp_open = false;
        if (close_status != 0) throw std::runtime_error("cannot write hint");
        if (rename(temporary.c_str(), filename.c_str()) != 0) throw std::runtime_error("cannot publish hint");
    } catch (...) { if (fp_open) fclose(fp); unlink(temporary.c_str()); throw; }
}
#endif
}  // namespace

// Pool management accepts scheme base paths, matching the rest of the JS API.
// It deliberately only maps .hint; .config remains per-query and immediately
// reflects configuration commands.
static std::string hint_filename(const std::string& base) { return base + ".hint"; }

Napi::Object word_hint_preload(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    Napi::Object ret = Napi::Object::New(env);
    Napi::Array ok = Napi::Array::New(env), failed = Napi::Array::New(env);
    if (info.Length() < 1 || !info[0].IsArray()) {
        Napi::TypeError::New(env, "preload expects an array of scheme paths").ThrowAsJavaScriptException();
        return ret;
    }
    auto paths = info[0].As<Napi::Array>();
    uint32_t ok_i = 0, bad_i = 0;
    for (uint32_t i = 0; i < paths.Length(); ++i) {
        std::string base = paths.Get(i).As<Napi::String>().Utf8Value();
        if (hint_mapping_pool().get(hint_filename(base))) ok.Set(ok_i++, base);
        else {
            Napi::Object item = Napi::Object::New(env);
            item.Set("path", base); item.Set("error", "cannot mmap .hint");
            failed.Set(bad_i++, item);
        }
    }
    ret.Set("ok", ok); ret.Set("failed", failed);
    return ret;
}

Napi::Boolean word_hint_replace(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    std::string base = info[0].As<Napi::String>().Utf8Value();
    return Napi::Boolean::New(env, hint_mapping_pool().replace(hint_filename(base)));
}

Napi::Boolean word_hint_remove(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    std::string base = info[0].As<Napi::String>().Utf8Value();
    hint_mapping_pool().remove(hint_filename(base));
    return Napi::Boolean::New(env, true);
}
Napi::Boolean word_hint_save_table(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    try {
        std::string path = info[0].As<Napi::String>().Utf8Value();
        std::string name = path + ".txt";
        FILE* fin = fopen(name.c_str(), "rb");
        if (!fin) return Napi::Boolean::New(env, false);
        TempFiles temp_files;
        std::vector<Pair> records;
        int tot = 0;
        std::string code, word;
        std::u32string code32;
        bool in_word = false;
        auto add_word = [&]() {
            if (word.empty()) return;
            if (code32.empty() && !code.empty()) code32 = to_utf32(code);
            Pair pair{code32, ++tot, to_utf32(word)};
            records.push_back(std::move(pair));
            word.clear();
        };
        auto end_line = [&]() {
            if (in_word) add_word();
            code.clear();
            word.clear();
            code32.clear();
            in_word = false;
        };

        size_t read_size;
        while ((read_size = fread(buf, 1, sizeof(buf), fin)) != 0) {
            for (size_t i = 0; i < read_size; ++i) {
                char ch = buf[i];
                if (ch == '\r' || ch == '\n') {
                    end_line();
                } else if (ch == '\t') {
                    if (in_word) add_word();
                    else in_word = true;
                } else if (in_word) {
                    word.push_back(ch);
                } else {
                    code.push_back(ch);
                }
            }
        }
        if (ferror(fin)) { fclose(fin); throw std::runtime_error("cannot read table"); }
        fclose(fin);
        if (in_word) add_word();
        std::sort(records.begin(), records.end());
        Data data;
        data.config.set_default(); data.word_trie.init(); data.code_trie.init();
        for (const auto& record : records) data.insert(record.code, record.word);
        data.pre_calculate();
        std::string hint_name = path + ".hint", config_name = path + ".config";
        auto [hint_fp, hint_temp] = make_temp_file(hint_name + ".tmp.XXXXXX");
        temp_files.paths.push_back(hint_temp);
        bool hint_open = true;
        try {
            BufferedFileWriter out(hint_fp); data.write(out);
            if (!out.flush()) throw std::runtime_error("cannot write hint");
            if (fclose(hint_fp) != 0) { hint_open = false; throw std::runtime_error("cannot write hint"); }
            hint_open = false;
        } catch (...) { if (hint_open) fclose(hint_fp); throw; }
        auto [config_fp, config_temp] = make_temp_file(config_name + ".tmp.XXXXXX");
        temp_files.paths.push_back(config_temp);
        std::string config_byte = data.config.save();
        bool config_ok = fwrite(config_byte.data(), 1, config_byte.size(), config_fp) == config_byte.size();
        int config_close = fclose(config_fp);
        if (!config_ok || config_close != 0) throw std::runtime_error("cannot write config");
        if (rename(config_temp.c_str(), config_name.c_str()) != 0 || rename(hint_temp.c_str(), hint_name.c_str()) != 0)
            throw std::runtime_error("cannot publish table");
        unlink(config_temp.c_str()); unlink(hint_temp.c_str());

        return Napi::Boolean::New(env, true);
    } catch (std::exception e) {
        std::cout << e.what() << '\n';
        Napi::Error::New(env, "词提文件转化错误").ThrowAsJavaScriptException();
        return Napi::Boolean::New(env, false);
    }
}

// 参数一：方案文件名(不带扩展名)
Napi::Object word_hint_get_ext(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();

    std::string scheme = info[0].As<Napi::String>().Utf8Value();
    std::string filename = scheme + ".config";
    Solve solver;
    if (!solver.data.load_config(filename)) {
        Napi::Error::New(env, std::string("方案文件\"") + scheme +
                                  std::string(".config\"不存在"))
            .ThrowAsJavaScriptException();
        return env.Null().As<Napi::Object>();
    }
    Napi::Object res = Napi::Object::New(env);
    // candidate: '_;\'4567890',
    // maxlen: 4,
    // punct: ''
    res.Set("candidate",
            to_utf8(std::u32string(solver.data.config.xuan_chong.begin(),
                                   solver.data.config.xuan_chong.end())));
    res.Set("maxlen", solver.data.config.max_len);
    res.Set("punct", to_utf8(std::u32string(solver.data.config.punct.begin(),
                                            solver.data.config.punct.end())));
    res.Set("codeelem",
            to_utf8(std::u32string(solver.data.config.code_elem.begin(),
                                   solver.data.config.code_elem.end())));
    return res;
}

// 参数一：方案文件名(.hint)
// 参数二：设置参数对象
Napi::Boolean word_hint_set_ext(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();

    std::string scheme = info[0].As<Napi::String>().Utf8Value();
    std::string filename = scheme + ".config";
    std::u32string candidate =
        to_utf32(info[1]
                     .As<Napi::Object>()
                     .Get(Napi::String::New(env, "candidate"))
                     .As<Napi::String>()
                     .Utf8Value());
    int maxlen = info[1]
                     .As<Napi::Object>()
                     .Get(Napi::String::New(env, "maxlen"))
                     .As<Napi::Number>()
                     .Int32Value();
    std::u32string punct = to_utf32(info[1]
                                        .As<Napi::Object>()
                                        .Get(Napi::String::New(env, "punct"))
                                        .As<Napi::String>()
                                        .Utf8Value());
    Solve solver;
    if (!solver.data.load_config(filename)) {
        Napi::Error::New(env, std::string("方案文件\"") + scheme +
                                  std::string(".config\"不存在"))
            .ThrowAsJavaScriptException();
        return Napi::Boolean::New(env, false);
    }

    solver.data.config.xuan_chong =
        std::vector<char32_t>(candidate.begin(), candidate.end());
    solver.data.config.max_len = maxlen;
    solver.data.config.punct = std::set<char32_t>(punct.begin(), punct.end());

    std::string config_byte = solver.data.config.save();
    FILE* fp = fopen(filename.c_str(), "wb");
    if (!fp) return Napi::Boolean::New(env, false);
    fwrite(config_byte.data(), 1, config_byte.size(), fp);
    fclose(fp);

    return Napi::Boolean::New(env, true);
}

Napi::Boolean word_hint_has_word(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    try {
        Solve solver;

        std::string text = info[0].As<Napi::String>().Utf8Value();
        std::string type = info[1].As<Napi::String>().Utf8Value();
        
        
        std::string type_hint = type + ".hint";
        std::string type_config = type + ".config";

        if (!solver.data.load_hint(type_hint)) {
            Napi::Error::New(env, std::string("方案文件\"") + type +
                                      std::string(".hint\"不存在"))
                .ThrowAsJavaScriptException();
            return Napi::Boolean::New(env, false);
        }

        if (!solver.data.load_config(type_config)) {
            Napi::Error::New(env, std::string("方案文件\"") + type +
                                      std::string(".config\"不存在"))
                .ThrowAsJavaScriptException();
            return Napi::Boolean::New(env, false);
        }

        std::u32string u32_text = to_utf32(text);
        bool res = solver.has_word(u32_text);

        solver.data.unload_hint();
        return Napi::Boolean::New(env, res);

    } catch (std::exception e) {
        std::cout << e.what() << '\n';
        Napi::Error::New(env, "词提文件出现错误").ThrowAsJavaScriptException();
        return Napi::Boolean::New(env, false);
    }
}

Napi::Object word_hint_solve_simple(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    try {
        Solve solver;

        std::string text = info[0].As<Napi::String>().Utf8Value();
        std::string type = info[1].As<Napi::String>().Utf8Value();
        
        int l = 0, r = 500;
        if (info.Length() > 2 && info[2].IsObject()) {
            Napi::Value tmp;
            if (info[2].As<Napi::Object>().Has("l")) {
                tmp = info[2].As<Napi::Object>().Get("l");
                if (tmp.IsNumber()) {
                    l = tmp.As<Napi::Number>().Int32Value();
                }
            }
            if (info[2].As<Napi::Object>().Has("r")) {
                tmp = info[2].As<Napi::Object>().Get("r");
                if (tmp.IsNumber()) {
                    r = tmp.As<Napi::Number>().Int32Value();
                }
            }
        } 
        
        std::string type_hint = type + ".hint";
        std::string type_config = type + ".config";

        if (!solver.data.load_hint(type_hint)) {
            Napi::Error::New(env, std::string("方案文件\"") + type +
                                      std::string(".hint\"不存在"))
                .ThrowAsJavaScriptException();
            return env.Null().As<Napi::Object>();
        }

        if (!solver.data.load_config(type_config)) {
            Napi::Error::New(env, std::string("方案文件\"") + type +
                                      std::string(".config\"不存在"))
                .ThrowAsJavaScriptException();
            return env.Null().As<Napi::Object>();
        }

        std::u32string u32_text = to_utf32(text);

        SimpleAnswer ans = solver.solve_simple(u32_text);

        Napi::Object ret = Napi::Object::New(env);
        ret.Set(Napi::String::New(env, "word"), to_utf8(ans.word));
        Napi::Object ret_show_list = Napi::Array::New(env, std::max(0, std::min(r, (int)ans.code.size()) - l));

        for (int i = l; i < std::min(r, (int)ans.code.size()); i++) {
            const auto& it = ans.code[i];
            Napi::Object show = Napi::Object::New(env);
            show.Set(Napi::String::New(env, "code"), to_utf8(it.code));
            show.Set(Napi::String::New(env, "index"), it.index);
            show.Set(Napi::String::New(env, "display_word"), Napi::String::New(env, to_utf8(it.display_word)));
            ret_show_list.Set(i - l, show);
        }

        ret.Set(Napi::String::New(env, "code"), ret_show_list);
        ret.Set(Napi::String::New(env, "whole_num"), (int)ans.code.size());
        ret.Set(Napi::String::New(env, "l"), l);
        solver.data.unload_hint();
        return ret;
    } catch (std::exception e) {
        std::cout << e.what() << '\n';
        Napi::Error::New(env, "词提文件出现错误").ThrowAsJavaScriptException();
        return env.Null().As<Napi::Object>();
    }
}

Napi::Object word_hint_solve_search(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    try {
        Solve solver;

        std::string text = info[0].As<Napi::String>().Utf8Value();
        std::string type = info[1].As<Napi::String>().Utf8Value();
        int l = 0, r = 500;
        if (info.Length() > 2 && info[2].IsObject()) {
            Napi::Value tmp;
            if (info[2].As<Napi::Object>().Has("l")) {
                tmp = info[2].As<Napi::Object>().Get("l");
                if (tmp.IsNumber()) {
                    l = tmp.As<Napi::Number>().Int32Value();
                }
            }
            if (info[2].As<Napi::Object>().Has("r")) {
                tmp = info[2].As<Napi::Object>().Get("r");
                if (tmp.IsNumber()) {
                    r = tmp.As<Napi::Number>().Int32Value();
                }
            }
        } 

        std::string type_hint = type + ".hint";
        std::string type_config = type + ".config";
        

        if (!solver.data.load_hint(type_hint)) {
            Napi::Error::New(env, std::string("方案文件\"") + type +
                                      std::string(".hint\"不存在"))
                .ThrowAsJavaScriptException();
            return env.Null().As<Napi::Object>();
        }

        if (!solver.data.load_config(type_config)) {
            Napi::Error::New(env, std::string("方案文件\"") + type +
                                      std::string(".config\"不存在"))
                .ThrowAsJavaScriptException();
            return env.Null().As<Napi::Object>();
        }

        std::u32string u32_text = to_utf32(text);

        SearchAnswer ans = solver.solve_search(u32_text);

        Napi::Object ret = Napi::Object::New(env);
        ret.Set(Napi::String::New(env, "code"), to_utf8(ans.code));
        Napi::Object ret_show_list = Napi::Array::New(env, std::max(0, std::min(r, (int)ans.term.size()) - l));

        for (int i = l; i < std::min(r, (int)ans.term.size()); i++) {
            const auto& it = ans.term[i];
            Napi::Object term = Napi::Object::New(env);
            term.Set(Napi::String::New(env, "word"), Napi::String::New(env, to_utf8(it.word)));
            term.Set(Napi::String::New(env, "display_code"), Napi::String::New(env, to_utf8(it.display_code)));
            ret_show_list.Set(i - l, term);
        }

        ret.Set(Napi::String::New(env, "word"), ret_show_list);
        ret.Set(Napi::String::New(env, "whole_num"), (int)ans.term.size());
        ret.Set(Napi::String::New(env, "l"), l);
        solver.data.unload_hint();
        return ret;
    } catch (std::exception e) {
        std::cout << e.what() << '\n';
        Napi::Error::New(env, "词提文件出现错误").ThrowAsJavaScriptException();
        return env.Null().As<Napi::Object>();
    }
}

Napi::Object word_hint_solve_one(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    try {
        Solve solver;

        std::string text = info[0].As<Napi::String>().Utf8Value();
        std::string type = info[1].As<Napi::String>().Utf8Value();

        std::string type_hint = type + ".hint";
        std::string type_config = type + ".config";
        

        if (!solver.data.load_hint(type_hint)) {
            Napi::Error::New(env, std::string("方案文件\"") + type +
                                      std::string(".hint\"不存在"))
                .ThrowAsJavaScriptException();
            return env.Null().As<Napi::Object>();
        }

        if (!solver.data.load_config(type_config)) {
            Napi::Error::New(env, std::string("方案文件\"") + type +
                                      std::string(".config\"不存在"))
                .ThrowAsJavaScriptException();
            return env.Null().As<Napi::Object>();
        }

        std::u32string u32_text = to_utf32(text);

        Answer ans = solver.solve_one(u32_text);

        Napi::Object ret = Napi::Object::New(env);
        Napi::Object ret_show_list = Napi::Array::New(env, ans.ans.size());
        ret.Set(Napi::String::New(env, "code_len"), ans.code_len);
        ret.Set(Napi::String::New(env, "num_of_candidate"), ans.chongshu);
        ret.Set(Napi::String::New(env, "num_of_char"), u32_text.size());
        ret.Set(Napi::String::New(env, "num_of_que"), ans.queshu);

        for (int i = 0; i < ans.ans.size(); i++) {
            const auto& it = ans.ans[i];
            Napi::Object show = Napi::Object::New(env);
            show.Set(Napi::String::New(env, "code"), to_utf8(it.code));
            show.Set(Napi::String::New(env, "word"), to_utf8(it.word));
            show.Set(Napi::String::New(env, "type"), it.type);
            show.Set(Napi::String::New(env, "is_chong"), (bool)it.is_chong);
            show.Set(Napi::String::New(env, "is_que"), (bool)it.is_que);
            ret_show_list.Set(i, show);
        }

        ret.Set(Napi::String::New(env, "show_list"), ret_show_list);
        solver.data.unload_hint();
        return ret;
    } catch (std::exception e) {
        std::cout << e.what() << '\n';
        Napi::Error::New(env, "词提文件出现错误").ThrowAsJavaScriptException();
        return env.Null().As<Napi::Object>();
    }
}

Napi::String word_hint_solve_code(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    try {
        Solve solver;

        std::string text = info[0].As<Napi::String>().Utf8Value();
        std::string type = info[1].As<Napi::String>().Utf8Value();

        std::string type_hint = type + ".hint";
        std::string type_config = type + ".config";
        

        if (!solver.data.load_hint(type_hint)) {
            Napi::Error::New(env, std::string("方案文件\"") + type +
                                      std::string(".hint\"不存在"))
                .ThrowAsJavaScriptException();
            return Napi::String::New(env, "");
        }

        if (!solver.data.load_config(type_config)) {
            Napi::Error::New(env, std::string("方案文件\"") + type +
                                      std::string(".config\"不存在"))
                .ThrowAsJavaScriptException();
            return Napi::String::New(env, "");
        }

        std::u32string u32_text = to_utf32(text);

        std::u32string ans = solver.solve_code(u32_text);
        solver.data.unload_hint();
        return Napi::String::New(env, to_utf8(ans));
    } catch (std::exception e) {
        std::cout << e.what() << '\n';
        Napi::Error::New(env, "词提文件出现错误").ThrowAsJavaScriptException();
        return Napi::String::New(env, "");
    }
}

Napi::Object word_hint_solve_simple_func(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    try {
        Solve solver;

        auto func = info[0].As<Napi::Function>();
        std::string type = info[1].As<Napi::String>().Utf8Value();
        
        int l = 0, r = 500;
        if (info.Length() > 2 && info[2].IsObject()) {
            Napi::Value tmp;
            if (info[2].As<Napi::Object>().Has("l")) {
                tmp = info[2].As<Napi::Object>().Get("l");
                if (tmp.IsNumber()) {
                    l = tmp.As<Napi::Number>().Int32Value();
                }
            }
            if (info[2].As<Napi::Object>().Has("r")) {
                tmp = info[2].As<Napi::Object>().Get("r");
                if (tmp.IsNumber()) {
                    r = tmp.As<Napi::Number>().Int32Value();
                }
            }
        } 
        
        std::string type_hint = type + ".hint";
        std::string type_config = type + ".config";

        if (!solver.data.load_hint(type_hint)) {
            Napi::Error::New(env, std::string("方案文件\"") + type +
                                      std::string(".hint\"不存在"))
                .ThrowAsJavaScriptException();
            return env.Null().As<Napi::Object>();
        }

        if (!solver.data.load_config(type_config)) {
            Napi::Error::New(env, std::string("方案文件\"") + type +
                                      std::string(".config\"不存在"))
                .ThrowAsJavaScriptException();
            return env.Null().As<Napi::Object>();
        }

        

        auto ans = solver.solve_simple_func(func);

        Napi::Object ret = Napi::Object::New(env);
        // ret.Set(Napi::String::New(env, "word"), to_utf8(ans.word));
        Napi::Object ret_show_list = Napi::Array::New(env, std::max(0, std::min(r, (int)ans.size()) - l));

        for (int i = l; i < std::min(r, (int)ans.size()); i++) {
            const auto& it = ans[i];
            Napi::Object show = Napi::Object::New(env);
            show.Set(Napi::String::New(env, "code"), to_utf8(it.code));
            show.Set(Napi::String::New(env, "index"), it.index);
            show.Set(Napi::String::New(env, "display_word"), Napi::String::New(env, to_utf8(it.display_word)));
            ret_show_list.Set(i - l, show);
        }

        ret.Set(Napi::String::New(env, "code"), ret_show_list);
        ret.Set(Napi::String::New(env, "whole_num"), (int)ans.size());
        ret.Set(Napi::String::New(env, "l"), l);
        solver.data.unload_hint();
        return ret;
    } catch (std::exception e) {
        std::cout << e.what() << '\n';
        Napi::Error::New(env, "词提文件出现错误").ThrowAsJavaScriptException();
        return env.Null().As<Napi::Object>();
    }
}

Napi::Object word_hint_solve_search_func(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    try {
        Solve solver;

        auto func = info[0].As<Napi::Function>();
        std::string type = info[1].As<Napi::String>().Utf8Value();
        int l = 0, r = 500;
        if (info.Length() > 2 && info[2].IsObject()) {
            Napi::Value tmp;
            if (info[2].As<Napi::Object>().Has("l")) {
                tmp = info[2].As<Napi::Object>().Get("l");
                if (tmp.IsNumber()) {
                    l = tmp.As<Napi::Number>().Int32Value();
                }
            }
            if (info[2].As<Napi::Object>().Has("r")) {
                tmp = info[2].As<Napi::Object>().Get("r");
                if (tmp.IsNumber()) {
                    r = tmp.As<Napi::Number>().Int32Value();
                }
            }
        } 

        std::string type_hint = type + ".hint";
        std::string type_config = type + ".config";
        

        if (!solver.data.load_hint(type_hint)) {
            Napi::Error::New(env, std::string("方案文件\"") + type +
                                      std::string(".hint\"不存在"))
                .ThrowAsJavaScriptException();
            return env.Null().As<Napi::Object>();
        }

        if (!solver.data.load_config(type_config)) {
            Napi::Error::New(env, std::string("方案文件\"") + type +
                                      std::string(".config\"不存在"))
                .ThrowAsJavaScriptException();
            return env.Null().As<Napi::Object>();
        }



        auto ans = solver.solve_search_func(func);

        Napi::Object ret = Napi::Object::New(env);

        Napi::Object ret_show_list = Napi::Array::New(env, std::max(0, std::min(r, (int)ans.size()) - l));

        for (int i = l; i < std::min(r, (int)ans.size()); i++) {
            const auto& it = ans[i];
            Napi::Object term = Napi::Object::New(env);
            term.Set(Napi::String::New(env, "word"), Napi::String::New(env, to_utf8(it.word)));
            term.Set(Napi::String::New(env, "display_code"), Napi::String::New(env, to_utf8(it.display_code)));
            ret_show_list.Set(i - l, term);
        }

        ret.Set(Napi::String::New(env, "word"), ret_show_list);
        ret.Set(Napi::String::New(env, "whole_num"), (int)ans.size());
        ret.Set(Napi::String::New(env, "l"), l);
        solver.data.unload_hint();
        return ret;
    } catch (std::exception e) {
        std::cout << e.what() << '\n';
        Napi::Error::New(env, "词提文件出现错误").ThrowAsJavaScriptException();
        return env.Null().As<Napi::Object>();
    }
}

Napi::Object word_hint_solve_simple_search_func(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    try {
        Solve solver;

        auto func_simple = info[0].As<Napi::Function>();
        auto func_search = info[1].As<Napi::Function>();
        auto func_chong = info[2].As<Napi::Function>();
        std::string type = info[3].As<Napi::String>().Utf8Value();
        
        int l = 0, r = 500;
        if (info.Length() > 2 && info[4].IsObject()) {
            Napi::Value tmp;
            if (info[4].As<Napi::Object>().Has("l")) {
                tmp = info[4].As<Napi::Object>().Get("l");
                if (tmp.IsNumber()) {
                    l = tmp.As<Napi::Number>().Int32Value();
                }
            }
            if (info[4].As<Napi::Object>().Has("r")) {
                tmp = info[4].As<Napi::Object>().Get("r");
                if (tmp.IsNumber()) {
                    r = tmp.As<Napi::Number>().Int32Value();
                }
            }
        } 
        
        std::string type_hint = type + ".hint";
        std::string type_config = type + ".config";

        if (!solver.data.load_hint(type_hint)) {
            Napi::Error::New(env, std::string("方案文件\"") + type +
                                      std::string(".hint\"不存在"))
                .ThrowAsJavaScriptException();
            return env.Null().As<Napi::Object>();
        }

        if (!solver.data.load_config(type_config)) {
            Napi::Error::New(env, std::string("方案文件\"") + type +
                                      std::string(".config\"不存在"))
                .ThrowAsJavaScriptException();
            return env.Null().As<Napi::Object>();
        }

        auto ans = solver.solve_simple_search_func(func_simple, func_search, func_chong);

        Napi::Object ret = Napi::Object::New(env);
        // ret.Set(Napi::String::New(env, "word"), to_utf8(ans.word));
        Napi::Object ret_show_list = Napi::Array::New(env, std::max(0, std::min(r, (int)ans.size()) - l));

        for (int i = l; i < std::min(r, (int)ans.size()); i++) {
            const auto& it = ans[i];
            Napi::Object show = Napi::Object::New(env);
            show.Set(Napi::String::New(env, "code"), to_utf8(it.code));
            show.Set(Napi::String::New(env, "index"), it.index);
            show.Set(Napi::String::New(env, "display_word"), Napi::String::New(env, to_utf8(it.display_word)));
            ret_show_list.Set(i - l, show);
        }

        ret.Set(Napi::String::New(env, "code"), ret_show_list);
        ret.Set(Napi::String::New(env, "whole_num"), (int)ans.size());
        ret.Set(Napi::String::New(env, "l"), l);
        solver.data.unload_hint();
        return ret;
    } catch (std::exception e) {
        std::cout << e.what() << '\n';
        Napi::Error::New(env, "词提文件出现错误").ThrowAsJavaScriptException();
        return env.Null().As<Napi::Object>();
    }
}

Napi::Object init(Napi::Env env, Napi::Object exports) {
    exports.Set("solve", Napi::Function::New(env, word_hint_solve));
    exports.Set("save_table", Napi::Function::New(env, word_hint_save_table));
    exports.Set("preload", Napi::Function::New(env, word_hint_preload));
    exports.Set("replace", Napi::Function::New(env, word_hint_replace));
    exports.Set("remove", Napi::Function::New(env, word_hint_remove));
    exports.Set("get_ext", Napi::Function::New(env, word_hint_get_ext));
    exports.Set("set_ext", Napi::Function::New(env, word_hint_set_ext));
    exports.Set("solve_simple",
                Napi::Function::New(env, word_hint_solve_simple));
    exports.Set("solve_search",
                Napi::Function::New(env, word_hint_solve_search));
    exports.Set("solve_one", Napi::Function::New(env, word_hint_solve_one));
    exports.Set("solve_code", Napi::Function::New(env, word_hint_solve_code));
    exports.Set("solve_simple_func",
                Napi::Function::New(env, word_hint_solve_simple_func));
    exports.Set("solve_search_func",
                Napi::Function::New(env, word_hint_solve_search_func));
    exports.Set("solve_simple_search_func",
                Napi::Function::New(env, word_hint_solve_simple_search_func));
    exports.Set("has_word", Napi::Function::New(env, word_hint_has_word));
    return exports;
}

NODE_API_MODULE(word_hint, init)
