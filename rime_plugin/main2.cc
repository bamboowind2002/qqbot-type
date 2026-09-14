#include <napi.h>
#include <rime_api.h>

#include <iostream>
#define MAYBE_STR(x) ((x) ? (x) : "")

struct RimeAPI {
    RimeAPI(RimeApi* rime, const std::string& folder) : rime(rime) {
        RIME_STRUCT(RimeTraits, traits);
        traits.app_name = "rime.console";
        traits.user_data_dir = folder.c_str();
        traits.shared_data_dir = folder.c_str();
        rime->setup(&traits);
        rime->initialize(NULL);
    }
    
    ~RimeAPI() {
        rime->finalize();
    }
    RimeApi* rime;
};

void deploy(const Napi::CallbackInfo& info) {
    std::string folder = info[0].As<Napi::String>().Utf8Value();
    RimeAPI api(rime_get_api(), folder);
    
    Bool full_check = True;
    if (api.rime->start_maintenance(full_check)) {
        api.rime->join_maintenance_thread();
    }

}

Napi::Array get_schema_list(const Napi::CallbackInfo& info) {
    auto env = info.Env();
    std::string folder = info[0].As<Napi::String>().Utf8Value();
    RimeAPI api(rime_get_api(), folder);
    

    auto res = Napi::Array::New(env);
    RimeSchemaList schema_list;
    if (api.rime->get_schema_list(&schema_list)) {
        for (size_t i = 0; i < schema_list.size; i++) {
            auto tmp = Napi::Object::New(env);
            auto t = schema_list.list[i];
            tmp.Set("schema_id", MAYBE_STR(t.schema_id));
            tmp.Set("name", MAYBE_STR(t.name));
            res.Set(i, tmp);
        }
        api.rime->free_schema_list(&schema_list);
    }

    return res;
}

Napi::Object make_text_data(const Napi::Env& env, const std::string& text) {
    auto res = Napi::Object::New(env);
    res.Set("type", "text");
    res.Set("data", text);
    return res;
}

Napi::Object make_special_token_data(const Napi::Env& env,
                                     const std::string& type) {
    auto res = Napi::Object::New(env);
    res.Set("type", type);
    return res;
}

Napi::Object simulate_key(const Napi::CallbackInfo& info) {
    auto env = info.Env();
    std::string folder = info[0].As<Napi::String>().Utf8Value();
    std::string schema = info[1].As<Napi::String>().Utf8Value();
    std::string code = info[2].As<Napi::String>().Utf8Value();
    RimeAPI api(rime_get_api(), folder);
    auto res = Napi::Object::New(env);

    RimeSessionId id = api.rime->create_session();
    if (!id) {
        res.Set("error", "Error creating rime session");
        return res;
    }

    if (!api.rime->select_schema(id, schema.c_str())) {
        api.rime->destroy_session(id);
        res.Set("error", "Error selecting rime schema: " + schema);
        return res;
    }

    if (!api.rime->simulate_key_sequence(id, code.c_str())) {
        api.rime->destroy_session(id);
        res.Set("error", "Error processing key sequence: " + code);
        return res;
    }

    RIME_STRUCT(RimeCommit, commit);
    RIME_STRUCT(RimeContext, context);

    if (api.rime->get_commit(id, &commit)) {
        res.Set("commit", MAYBE_STR(commit.text));
        api.rime->free_commit(&commit);
    }

    if (api.rime->get_context(id, &context)) {
        RimeComposition composition = context.composition;
        RimeMenu menu = context.menu;

        if ((composition.length > 0 || menu.num_candidates > 0) &&
            composition.preedit) {
            auto preedit = Napi::Array::New(env);
            size_t len = strlen(composition.preedit);
            // fprintf(stderr, composition.preedit);
            size_t start = composition.sel_start;
            size_t end = composition.sel_end;
            size_t cursor = composition.cursor_pos;
            size_t tot = 0;
            std::string tmp_str;
            for (size_t i = 0; i <= len; ++i) {
                if (start < end) {
                    if (i == start) {
                        if (!tmp_str.empty()) {
                            preedit.Set(tot++, make_text_data(env, tmp_str));
                            tmp_str = "";
                        }
                        preedit.Set(tot++, make_special_token_data(env, "sel_start"));
                    } else if (i == end) {
                        if (!tmp_str.empty()) {
                            preedit.Set(tot++, make_text_data(env, tmp_str));
                            tmp_str = "";
                        }
                        preedit.Set(tot++, make_special_token_data(env, "sel_end"));
                    }
                }
                if (i == cursor) {
                    if (!tmp_str.empty()) {
                        preedit.Set(tot++, make_text_data(env, tmp_str));
                        tmp_str = "";
                    }
                    preedit.Set(tot++, make_special_token_data(env, "cursor"));
                }
                if (i < len) {
                    tmp_str.push_back(composition.preedit[i]);
                }
            }

            if (!tmp_str.empty()) {
                preedit.Set(tot++, make_text_data(env, tmp_str));
                tmp_str = "";
            }

            res.Set("preedit", preedit);
            auto tmp = Napi::Object::New(env);
            tmp.Set("page_no", menu.page_no);
            tmp.Set("page_size", menu.page_size);
            tmp.Set("is_last_page", bool(menu.is_last_page));
            auto tmp_menu = Napi::Array::New(env);
            for (int i = 0; i < menu.num_candidates; ++i) {
                bool highlighted = i == menu.highlighted_candidate_index;
                auto tmp_term = Napi::Object::New(env);
                tmp_term.Set("highlighted", highlighted);
                tmp_term.Set("text", MAYBE_STR(menu.candidates[i].text));
                tmp_term.Set("comment", MAYBE_STR(menu.candidates[i].comment));

                tmp_menu.Set(i, tmp_term);
            }
            tmp.Set("candidate", tmp_menu);
            res.Set("menu", tmp);
        }

        api.rime->free_context(&context);
    }

    api.rime->destroy_session(id);

    return res;
}

Napi::Object init(Napi::Env env, Napi::Object exports) {
    // Bool full_check = True;
    // if (rime->start_maintenance(full_check)) rime->join_maintenance_thread();

    exports.Set("get_schema_list", Napi::Function::New(env, get_schema_list));
    exports.Set("simulate_key", Napi::Function::New(env, simulate_key));
    exports.Set("deploy", Napi::Function::New(env, deploy));
    return exports;
}

NODE_API_MODULE(word_hint, init)