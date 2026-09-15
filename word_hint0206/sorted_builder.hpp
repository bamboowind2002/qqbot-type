#pragma once

#include <algorithm>
#include <cstdint>
#include <cstdio>
#include <functional>
#include <memory>
#include <queue>
#include <stdexcept>
#include <string>
#include <utility>
#include <vector>

namespace sorted_hint_builder {

constexpr size_t kRunBudget = 8 * 1024 * 1024;

struct Temps {
    std::vector<std::string> paths;
    ~Temps() {
        for (const auto& p : paths)
            if (!p.empty()) unlink(p.c_str());
    }
    std::pair<FILE*, std::string> create(const std::string& pattern) {
        std::string p = pattern;
        int fd = mkstemp(p.data());
        if (fd < 0) throw std::runtime_error("cannot create temporary file");
        FILE* fp = fdopen(fd, "w+b");
        if (!fp) {
            close(fd);
            unlink(p.c_str());
            throw std::runtime_error("cannot open temporary file");
        }
        paths.push_back(p);
        return {fp, p};
    }
    void remove(const std::string& path) {
        if (path.empty()) return;
        unlink(path.c_str());
        for (auto& registered : paths) {
            if (registered == path) {
                registered.clear();
                break;
            }
        }
    }
};

template <class T>
void pod_write(FILE* fp, const T& v) {
    if (fwrite(&v, sizeof(v), 1, fp) != 1)
        throw std::runtime_error("temporary write failed");
}
template <class T>
bool pod_read(FILE* fp, T& v) {
    if (fread(&v, sizeof(v), 1, fp) == 1) return true;
    if (feof(fp)) return false;
    throw std::runtime_error("temporary read failed");
}
inline void u32_write(FILE* fp, const std::u32string& s) {
    uint32_t n = s.size();
    pod_write(fp, n);
    if (n && fwrite(s.data(), sizeof(char32_t), n, fp) != n)
        throw std::runtime_error("temporary write failed");
}
inline bool u32_read(FILE* fp, std::u32string& s) {
    uint32_t n;
    if (!pod_read(fp, n)) return false;
    s.resize(n);
    if (n && fread(s.data(), sizeof(char32_t), n, fp) != n)
        throw std::runtime_error("corrupt temporary file");
    return true;
}

struct SourceRecord {
    std::u32string code, word;
    uint64_t pos = 0;
};
struct WordInput {
    std::u32string word, code;
    uint64_t pos = 0;
    int code_id = 0, index = 0;
};
struct Link {
    int owner = 0, order = 0, target = 0, index = 0;
};
struct NodeRecord {
    int id = 0, parent = 0, ch = 0, num = 0, sum = 0, len = 0;
    std::vector<std::pair<char32_t, int>> children;
};

struct SourceCodec {
    static size_t memory(const SourceRecord& r) {
        return sizeof(r) + 4 * (r.code.size() + r.word.size());
    }
    static void write(FILE* f, const SourceRecord& r) {
        u32_write(f, r.code);
        u32_write(f, r.word);
        pod_write(f, r.pos);
    }
    static bool read(FILE* f, SourceRecord& r) {
        if (!u32_read(f, r.code)) return false;
        if (!u32_read(f, r.word))
            throw std::runtime_error("corrupt source run");
        return pod_read(f, r.pos);
    }
};
struct WordInputCodec {
    static size_t memory(const WordInput& r) {
        return sizeof(r) + 4 * (r.code.size() + r.word.size());
    }
    static void write(FILE* f, const WordInput& r) {
        u32_write(f, r.word);
        u32_write(f, r.code);
        pod_write(f, r.pos);
        pod_write(f, r.code_id);
        pod_write(f, r.index);
    }
    static bool read(FILE* f, WordInput& r) {
        if (!u32_read(f, r.word)) return false;
        if (!u32_read(f, r.code)) throw std::runtime_error("corrupt word run");
        return pod_read(f, r.pos) && pod_read(f, r.code_id) &&
               pod_read(f, r.index);
    }
};
struct LinkCodec {
    static size_t memory(const Link&) { return sizeof(Link); }
    static void write(FILE* f, const Link& r) { pod_write(f, r); }
    static bool read(FILE* f, Link& r) { return pod_read(f, r); }
};
struct NodeCodec {
    static size_t memory(const NodeRecord& r) {
        return sizeof(r) + sizeof(r.children[0]) * r.children.size();
    }
    static void write(FILE* f, const NodeRecord& r) {
        pod_write(f, r.id);
        pod_write(f, r.parent);
        pod_write(f, r.ch);
        pod_write(f, r.num);
        pod_write(f, r.sum);
        pod_write(f, r.len);
        uint32_t n = r.children.size();
        pod_write(f, n);
        for (auto e : r.children) {
            pod_write(f, e.first);
            pod_write(f, e.second);
        }
    }
    static bool read(FILE* f, NodeRecord& r) {
        if (!pod_read(f, r.id)) return false;
        pod_read(f, r.parent);
        pod_read(f, r.ch);
        pod_read(f, r.num);
        pod_read(f, r.sum);
        pod_read(f, r.len);
        uint32_t n;
        pod_read(f, n);
        r.children.resize(n);
        for (auto& e : r.children) {
            pod_read(f, e.first);
            pod_read(f, e.second);
        }
        return true;
    }
};

template <class T, class Codec, class Less>
class Sorter {
   public:
    Sorter(Temps& t, std::string base, Less less)
        : temps_(t), base_(std::move(base)), less_(less) {}
    void add(T r) {
        bytes_ += Codec::memory(r);
        buf_.push_back(std::move(r));
        if (bytes_ >= kRunBudget) flush();
    }
    std::string finish() {
        flush();
        auto [out, path] = temps_.create(base_ + ".merged.XXXXXX");
        struct Cursor {
            FILE* fp;
            T value;
            size_t run;
        };
        struct Greater {
            Less less;
            bool operator()(const Cursor& a, const Cursor& b) const {
                return less(b.value, a.value);
            }
        };
        std::vector<FILE*> files(runs_.size(), nullptr);
        std::priority_queue<Cursor, std::vector<Cursor>, Greater> heap(
            Greater{less_});
        bool out_open = true;
        try {
            for (size_t i = 0; i < runs_.size(); ++i) {
                files[i] = fopen(runs_[i].c_str(), "rb");
                if (!files[i]) throw std::runtime_error("cannot open sort run");
                T value;
                if (Codec::read(files[i], value)) {
                    heap.push({files[i], std::move(value), i});
                } else {
                    fclose(files[i]);
                    files[i] = nullptr;
                    temps_.remove(runs_[i]);
                }
            }
            while (!heap.empty()) {
                Cursor cursor = heap.top();
                heap.pop();
                Codec::write(out, cursor.value);
                T value;
                if (Codec::read(cursor.fp, value)) {
                    heap.push({cursor.fp, std::move(value), cursor.run});
                } else {
                    fclose(cursor.fp);
                    files[cursor.run] = nullptr;
                    temps_.remove(runs_[cursor.run]);
                }
            }
            if (fclose(out) != 0) {
                out_open = false;
                throw std::runtime_error("cannot close merged run");
            }
            out_open = false;
            runs_.clear();
            return path;
        } catch (...) {
            for (FILE* file : files)
                if (file) fclose(file);
            if (out_open) fclose(out);
            throw;
        }
    }

   private:
    void flush() {
        if (buf_.empty()) return;
        std::sort(buf_.begin(), buf_.end(), less_);
        auto [f, p] = temps_.create(base_ + ".run.XXXXXX");
        for (const auto& r : buf_) Codec::write(f, r);
        if (fclose(f) != 0) throw std::runtime_error("cannot close sort run");
        runs_.push_back(p);
        buf_.clear();
        bytes_ = 0;
    }
    Temps& temps_;
    std::string base_;
    Less less_;
    std::vector<T> buf_;
    std::vector<std::string> runs_;
    size_t bytes_ = 0;
};

template <class T, class Codec>
class Reader {
   public:
    explicit Reader(const std::string& p) : fp_(fopen(p.c_str(), "rb")) {
        if (!fp_) throw std::runtime_error("cannot open merged file");
        has_ = Codec::read(fp_, cur_);
    }
    ~Reader() { fclose(fp_); }
    bool has() const { return has_; }
    const T& peek() const { return cur_; }
    T pop() {
        T r = std::move(cur_);
        has_ = Codec::read(fp_, cur_);
        return r;
    }

   private:
    FILE* fp_;
    T cur_;
    bool has_;
};

struct SourceLess {
    bool operator()(const SourceRecord& a, const SourceRecord& b) const {
        return a.code != b.code ? a.code < b.code : a.pos < b.pos;
    }
};
struct WordLess {
    bool operator()(const WordInput& a, const WordInput& b) const {
        if (a.word != b.word) return a.word < b.word;
        if (a.code.size() != b.code.size())
            return a.code.size() < b.code.size();
        if (a.code != b.code) return a.code < b.code;
        return a.pos < b.pos;
    }
};
struct LinkLess {
    bool operator()(const Link& a, const Link& b) const {
        return a.owner != b.owner ? a.owner < b.owner : a.order < b.order;
    }
};
struct NodeLess {
    bool operator()(const NodeRecord& a, const NodeRecord& b) const {
        return a.id < b.id;
    }
};

struct StackNode {
    NodeRecord node;
};
inline size_t lcp(const std::u32string& a, const std::u32string& b) {
    size_t i = 0, n = std::min(a.size(), b.size());
    while (i < n && a[i] == b[i]) ++i;
    return i;
}

inline void parse_source(const std::string& path,
                         Sorter<SourceRecord, SourceCodec, SourceLess>& out) {
    FILE* f = fopen((path + ".txt").c_str(), "rb");
    if (!f) throw std::runtime_error("cannot open table");
    char buffer[1 << 20];
    std::string code, word;
    bool in_word = false;
    uint64_t pos = 0;
    std::u32string code32;
    auto add = [&] {
        if (word.empty()) return;
        if (code32.empty() && !code.empty()) code32 = to_utf32(code);
        out.add({code32, to_utf32(word), ++pos});
        word.clear();
    };
    auto line = [&] {
        if (in_word) add();
        code.clear();
        word.clear();
        code32.clear();
        in_word = false;
    };
    size_t n;
    while ((n = fread(buffer, 1, sizeof(buffer), f)))
        for (size_t i = 0; i < n; ++i) {
            char c = buffer[i];
            if (c == '\r' || c == '\n')
                line();
            else if (c == '\t') {
                if (in_word)
                    add();
                else
                    in_word = true;
            } else
                (in_word ? word : code).push_back(c);
        }
    if (ferror(f)) {
        fclose(f);
        throw std::runtime_error("cannot read table");
    }
    fclose(f);
    if (in_word) add();
}

inline void close_to(std::vector<StackNode>& stack, size_t depth,
                     Sorter<NodeRecord, NodeCodec, NodeLess>& nodes) {
    while (stack.size() > depth + 1) {
        nodes.add(std::move(stack.back().node));
        stack.pop_back();
    }
}

inline int find_child(const std::vector<uint32_t>& begin,
                      const std::vector<char32_t>& chars,
                      const std::vector<int>& ids, int u, char32_t ch) {
    auto a = chars.begin() + begin[u], b = chars.begin() + begin[u + 1],
         it = std::lower_bound(a, b, ch);
    return it == b || *it != ch ? -1 : ids[it - chars.begin()];
}

inline bool build(const std::string& path) {
    Temps temps;
    Config config;
    config.set_default();
    Sorter<SourceRecord, SourceCodec, SourceLess> sources(temps, path + ".code",
                                                          {});
    parse_source(path, sources);
    std::string source_file = sources.finish();
    Sorter<NodeRecord, NodeCodec, NodeLess> code_nodes(temps, path + ".cn", {}),
        word_nodes(temps, path + ".wn", {});
    Sorter<WordInput, WordInputCodec, WordLess> word_inputs(temps, path + ".wi",
                                                            {});
    Sorter<Link, LinkCodec, LinkLess> code_words(temps, path + ".cw", {}),
        word_codes(temps, path + ".wc", {});
    std::vector<StackNode> st(1);
    st[0].node.id = 0;
    int next_id = 1;
    std::u32string prev;
    {
        Reader<SourceRecord, SourceCodec> in(source_file);
        while (in.has()) {
            SourceRecord r = in.pop();
            size_t common = lcp(prev, r.code);
            close_to(st, common, code_nodes);
            for (size_t i = common; i < r.code.size(); ++i) {
                NodeRecord n;
                n.id = next_id++;
                n.parent = st.back().node.id;
                n.ch = r.code[i];
                n.len = i + 1;
                st.back().node.children.push_back({r.code[i], n.id});
                st.push_back({std::move(n)});
            }
            for (auto& x : st) x.node.sum++;
            int idx = ++st.back().node.num;
            word_inputs.add({r.word, r.code, r.pos, st.back().node.id, idx});
            for (char32_t c : r.code) config.code_elem.insert(c);
            prev = r.code;
        }
        close_to(st, 0, code_nodes);
        code_nodes.add(std::move(st[0].node));
    }
    temps.remove(source_file);
    int code_count = next_id;
    std::string code_node_file = code_nodes.finish(),
                word_input_file = word_inputs.finish();
    st.clear();
    st.resize(1);
    st[0].node.id = 0;
    next_id = 1;
    prev.clear();
    int word_seq = 0;
    {
        Reader<WordInput, WordInputCodec> in(word_input_file);
        while (in.has()) {
            WordInput r = in.pop();
            size_t common = lcp(prev, r.word);
            close_to(st, common, word_nodes);
            for (size_t i = common; i < r.word.size(); ++i) {
                NodeRecord n;
                n.id = next_id++;
                n.parent = st.back().node.id;
                n.ch = r.word[i];
                n.len = i + 1;
                st.back().node.children.push_back({r.word[i], n.id});
                st.push_back({std::move(n)});
            }
            int wid = st.back().node.id;
            ++st.back().node.num;
            word_codes.add({wid, word_seq++, r.code_id, r.index});
            code_words.add({r.code_id, r.index, wid, 0});
            prev = r.word;
        }
        close_to(st, 0, word_nodes);
        word_nodes.add(std::move(st[0].node));
    }
    temps.remove(word_input_file);
    int word_count = next_id;
    std::string word_node_file = word_nodes.finish(),
                cw_file = code_words.finish(), wc_file = word_codes.finish();
    std::vector<uint32_t> begin(word_count + 1, 0);
    std::vector<char32_t> chars;
    std::vector<int> ids;
    {
        Reader<NodeRecord, NodeCodec> in(word_node_file);
        while (in.has()) {
            NodeRecord n = in.pop();
            begin[n.id] = chars.size();
            for (auto e : n.children) {
                chars.push_back(e.first);
                ids.push_back(e.second);
            }
        }
        begin[word_count] = chars.size();
    }
    std::vector<uint8_t> terminal(word_count, 0);
    {
        Reader<Link, LinkCodec> in(wc_file);
        while (in.has()) terminal[in.pop().owner] = 1;
    }
    std::vector<int> fail(word_count, 0), last(word_count, 0), q;
    q.reserve(word_count);
    for (uint32_t i = begin[0]; i < begin[1]; ++i) q.push_back(ids[i]);
    for (size_t h = 0; h < q.size(); ++h) {
        int r = q[h];
        for (uint32_t i = begin[r]; i < begin[r + 1]; ++i) {
            int u = ids[i], v = fail[r], to;
            char32_t c = chars[i];
            q.push_back(u);
            while (v && (to = find_child(begin, chars, ids, v, c)) < 0)
                v = fail[v];
            to = find_child(begin, chars, ids, v, c);
            fail[u] = to < 0 ? 0 : to;
            last[u] = terminal[fail[u]] ? fail[u] : last[fail[u]];
        }
    }
    auto node_size = [&](const NodeRecord& n, bool word) {
        return size_t(4) * ((word ? 7 : 6) + 2 * n.children.size() +
                            (word ? 2 : 1) * n.num);
    };
    auto trie_size = [&](const std::string& nf, int count, bool word) {
        Reader<NodeRecord, NodeCodec> nr(nf);
        size_t z = 8ull * count;
        while (nr.has()) z += node_size(nr.pop(), word);
        return z;
    };
    size_t code_size = trie_size(code_node_file, code_count, false);
    auto [fp, tmp] = temps.create(path + ".hint.tmp.XXXXXX");
    BufferedFileWriter out(fp);
    long long co = 16, wo = 16 + code_size;
    out.write_pod(co);
    out.write_pod(wo);
    auto offsets = [&](const std::string& nf, int count, bool word) {
        Reader<NodeRecord, NodeCodec> nr(nf);
        size_t off = 8ull * count;
        while (nr.has()) {
            auto n = nr.pop();
            long long x = off;
            out.write_pod(x);
            off += node_size(n, word);
        }
    };
    auto bodies = [&](const std::string& nf, const std::string& lf, bool word) {
        Reader<NodeRecord, NodeCodec> nr(nf);
        Reader<Link, LinkCodec> lr(lf);
        while (nr.has()) {
            auto n = nr.pop();
            int c = n.children.size();
            out.write_pod(c);
            for (auto e : n.children) out.write_pod(e.first);
            for (auto e : n.children) out.write_pod(e.second);
            out.write_pod(n.parent);
            char32_t ch = n.ch;
            out.write_pod(ch);
            if (word) {
                out.write_pod(fail[n.id]);
                out.write_pod(last[n.id]);
                out.write_pod(n.len);
            } else {
                out.write_pod(n.num);
                out.write_pod(n.sum);
            }
            out.write_pod(n.num);
            for (int i = 0; i < n.num; ++i) {
                if (!lr.has() || lr.peek().owner != n.id)
                    throw std::runtime_error("broken candidate join");
                auto x = lr.pop();
                if (word) {
                    out.write_pod(x.target);
                    out.write_pod(x.index);
                } else
                    out.write_pod(x.target);
            }
        }
        if (lr.has()) throw std::runtime_error("orphan candidate link");
    };
    offsets(code_node_file, code_count, false);
    bodies(code_node_file, cw_file, false);
    temps.remove(code_node_file);
    temps.remove(cw_file);
    offsets(word_node_file, word_count, true);
    bodies(word_node_file, wc_file, true);
    temps.remove(word_node_file);
    temps.remove(wc_file);
    bool hint_ok = out.flush();
    int hint_close = fclose(fp);
    if (!hint_ok || hint_close != 0)
        throw std::runtime_error("cannot write hint");
    auto [cf, ct] = temps.create(path + ".config.tmp.XXXXXX");
    std::string cb = config.save();
    bool ok = fwrite(cb.data(), 1, cb.size(), cf) == cb.size();
    ok = fclose(cf) == 0 && ok;
    if (!ok || rename(ct.c_str(), (path + ".config").c_str()) ||
        rename(tmp.c_str(), (path + ".hint").c_str()))
        throw std::runtime_error("cannot publish table");
    return true;
}

}  // namespace sorted_hint_builder
