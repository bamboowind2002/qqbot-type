#include <napi.h>


#include <iostream>


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
        std::string fstr;
        size_t sz;
        while (sz = fread(buf, 1, 1 << 20, fin)) {
            fstr.append(buf, sz);
        }

        fclose(fin);
        int tot = 0;
        std::vector<Pair> table;
        for (int i = 0; i < fstr.size();) {
            while (i < fstr.size() && (fstr[i] == '\r' || fstr[i] == '\n')) {
                i++;
            }
            if (i >= fstr.size()) {
                break;
            }
            std::string code;
            while (i < fstr.size() && fstr[i] != '\t' && fstr[i] != '\n' &&
                   fstr[i] != '\r') {
                code += fstr[i];
                i++;
            }
            if (i >= fstr.size()) break;
            if (fstr[i] == '\r' || fstr[i] == '\n') continue;
            i++;
            int j;
            std::u32string code32 = to_utf32(code);
            for (j = i; j < fstr.size();) {
                std::string word;
                while (j < fstr.size() && fstr[j] != '\t' && fstr[j] != '\n' &&
                       fstr[j] != '\r') {
                    word += fstr[j];
                    j++;
                }
                if (word != "") {
                    ++tot;
                    // table[code32].push_back(to_utf32(word));
                    table.push_back({code32, tot, to_utf32(word)});
                }
                if (j >= fstr.size() || fstr[j] == '\n' || fstr[j] == '\r')
                    break;
                j++;
            }
            i = j;
        }
        std::sort(table.begin(), table.end());
        Data data;
        data.config.set_default();
        data.word_trie.init();
        data.code_trie.init();
        for (auto& it : table) {
            data.insert(it.code, it.word);
        }

        data.pre_calculate();

        std::string hint_byte = data.save();
        std::string hint_name = path + ".hint";
        std::string config_byte = data.config.save();
        std::string config_name = path + ".config";

        FILE* fp;
        fp = fopen(hint_name.c_str(), "wb");
        if (!fp) return Napi::Boolean::New(env, false);
        fwrite(hint_byte.data(), 1, hint_byte.size(), fp);
        fclose(fp);

        fp = fopen(config_name.c_str(), "wb");
        if (!fp) return Napi::Boolean::New(env, false);
        fwrite(config_byte.data(), 1, config_byte.size(), fp);
        fclose(fp);

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
