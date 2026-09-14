#pragma once
#include <codecvt>
#include <iostream>
#include <locale>

std::u32string to_utf32(std::string str) {
    return std::wstring_convert<std::codecvt_utf8<char32_t>, char32_t>{}
        .from_bytes(str);
}
std::string to_utf8(std::u32string str32) {
    return std::wstring_convert<std::codecvt_utf8<char32_t>, char32_t>{}
        .to_bytes(str32);
}