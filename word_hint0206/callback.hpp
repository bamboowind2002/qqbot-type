#pragma once
#ifndef NO_NAPI
#include <napi.h>
#endif
#include "helper.hpp"

#ifndef NO_NAPI
bool is_full_match(const std::u32string& txt, const Napi::Function& func) {
    std::string utf8_str = to_utf8(txt);
    auto js_str = Napi::String::New(func.Env(), utf8_str);
    auto res = func.Call({js_str});
    if (!res.IsBoolean()) {
        return false;
    }
    return res.As<Napi::Boolean>().Value();
}
#endif