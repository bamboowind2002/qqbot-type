#pragma once
#include <fcntl.h>
#include <sys/mman.h>
#include <sys/stat.h>
#include <unistd.h>

#include <algorithm>
#include <functional>
#include <map>
#include <queue>
#include <set>
#include <stack>
#include <string>
#include <vector>

#include "callback.hpp"

struct CodeTrieNode {
    std::map<char32_t, int> ch;
    int fa;
    char32_t fa_ch;

    int num, sum;

    std::vector<int> word_id;

    std::string save() const {
        std::string res;
        int ch_num = ch.size();
        std::vector<char32_t> ch_first(ch_num);
        std::vector<int> ch_second(ch_num);

        res.append((const char*)&ch_num, sizeof(int));

        auto it = ch.begin();
        for (int i = 0; i < ch_num; i++, ++it) {
            ch_first[i] = it->first;
            ch_second[i] = it->second;
        }

        for (int i = 0; i < ch_num; i++) {
            res.append((const char*)&ch_first[i], sizeof(int));
        }

        for (int i = 0; i < ch_num; i++) {
            res.append((const char*)&ch_second[i], sizeof(int));
        }

        res.append((const char*)&fa, sizeof(int));
        res.append((const char*)&fa_ch, sizeof(int));

        res.append((const char*)&num, sizeof(int));
        res.append((const char*)&sum, sizeof(int));

        int word_id_sz = word_id.size();
        res.append((const char*)&word_id_sz, sizeof(int));

        for (int i = 0; i < word_id_sz; i++) {
            res.append((const char*)&word_id[i], sizeof(int));
        }

        return res;
    }
};

/*
int ch_sz                  0
ch_sz个char32_t            1 * sizeof(int)
ch_sz个int                 (1 + ch_sz) * sizeof(int)
int fa                    (1 + 2 * ch_sz) * sizeof(int)
char32_t fa_ch            (2 + 2 * ch_sz) * sizeof(int)
int num                   (3 + 2 * ch_sz) * sizeof(int)
int sum                   (4 + 2 * ch_sz) * sizeof(int)

int word_id_sz            (5 + 2 * ch_sz) * sizeof(int)
word_id_sz个int           (6 + 2 * ch_sz) * sizeof(int)
*/

struct CodeTrieNodeReader {
    // FILE* fp;
    // long long offset;

    void* p;

    int get_ch_sz() const {
        int ch_sz = *(int*)p;
        return ch_sz;
    }

    std::pair<char32_t, int> get_ch_with_rk(int rk) const {
        int ch_sz = *(int*)p;
        int* pp = (int*)p + 1;
        if (rk < 0 || rk >= ch_sz) return {U'\0', -1};
        return {*((char32_t*)pp + rk), *((int*)pp + ch_sz + rk)};
    }

    int get_ch(char32_t ch) const {
        int ch_sz = *(int*)p;
        int tmp;
        int* pp = (int*)p + 1;
        int l = 0, r = ch_sz;
        int ed = ch_sz;
        while (l < r) {
            int mid = l + r >> 1;
            tmp = *((int*)pp + mid);
            if (tmp < ch) {
                l = mid + 1;
            } else {
                r = mid;
            }
        }
        if (l == ed) return -1;
        tmp = *((int*)pp + l);
        if (tmp != ch) return -1;
        tmp = *((int*)pp + ch_sz + l);
        return tmp;
    }

    int get_fa() const {
        int ch_sz, tmp;
        ch_sz = *(int*)p;
        tmp = *((int*)p + 1 + 2 * ch_sz);
        return tmp;
    }

    char32_t get_fa_ch() const {
        int ch_sz;
        char32_t tmp;
        ch_sz = *(int*)p;
        tmp = *((int*)p + 2 + 2 * ch_sz);
        return tmp;
    }

    int get_num() const {
        int ch_sz, tmp;
        ch_sz = *(int*)p;
        tmp = *((int*)p + 3 + 2 * ch_sz);
        return tmp;
    }

    int get_sum() const {
        int ch_sz, tmp;
        ch_sz = *(int*)p;
        tmp = *((int*)p + 4 + 2 * ch_sz);
        return tmp;
    }

    int get_word_id_sz() const {
        int ch_sz, tmp;
        ch_sz = *(int*)p;
        tmp = *((int*)p + 5 + 2 * ch_sz);
        return tmp;
    }

    int get_word_id(int u) const {
        int ch_sz, tmp;
        ch_sz = *(int*)p;
        tmp = *((int*)p + 6 + 2 * ch_sz + u);
        return tmp;
    }
};

struct CodeTrie {
    std::vector<CodeTrieNode> nodes;

    void init() {
        nodes.clear();
        nodes.push_back(CodeTrieNode());
    }

    int insert(const std::u32string& code) {
        int u = 0;
        for (char32_t ch : code) {
            nodes[u].sum++;
            auto it = nodes[u].ch.find(ch);
            if (it == nodes[u].ch.end()) {
                nodes.push_back(CodeTrieNode());
                nodes[u].ch[ch] = nodes.size() - 1;
                nodes.back().fa = u;
                nodes.back().fa_ch = ch;
            }
            u = nodes[u].ch[ch];
        }
        nodes[u].sum++;
        nodes[u].num++;

        return u;
    }

    std::string save() const {
        std::string head, res;
        for (auto& e : nodes) {
            long long offset = res.size() + sizeof(long long) * nodes.size();
            head.append((const char*)&offset, sizeof(long long));
            res.append(e.save());
        }
        return head + res;
    }
};

/*
head:
nodes.size()个long long
body:
*/

struct CodeTrieReader {
    void* p;

    CodeTrieNodeReader get_node(int u) const {
        CodeTrieNodeReader ans;
        long long addr;
        addr = *((long long*)p + u);
        ans.p = (void*)((char*)p + addr);
        return ans;
    }

    std::u32string get_code(int u) const {
        std::u32string res;
        while (u) {
            res.push_back(get_node(u).get_fa_ch());
            u = get_node(u).get_fa();
        }
        std::reverse(res.begin(), res.end());
        return res;
    }

    int get_len() const {
        int sz = *((long long*)p) / sizeof(long long);
        return sz;
    }
};

struct Code {
    int code, index;
    std::string save() const {
        std::string ans;
        ans.append((const char*)&code, sizeof(int));
        ans.append((const char*)&index, sizeof(int));
        return ans;
    }
};

struct CodeReader {
    void* p;

    int get_code() const {
        int tmp;
        tmp = *(int*)p;
        return tmp;
    }

    int get_index() const {
        int tmp;
        tmp = *((int*)p + 1);
        return tmp;
    }
};

struct WordTrieNode {
    std::map<char32_t, int> ch;

    int fail, last, len;
    std::vector<Code> codes;

    int fa;
    char32_t fa_ch;

    std::string save() const {
        std::string res;

        int ch_num = ch.size();
        std::vector<char32_t> ch_first(ch_num);
        std::vector<int> ch_second(ch_num);

        res.append((const char*)&ch_num, sizeof(int));

        auto it = ch.begin();
        for (int i = 0; i < ch_num; i++, ++it) {
            ch_first[i] = it->first;
            ch_second[i] = it->second;
        }

        for (int i = 0; i < ch_num; i++) {
            res.append((const char*)&ch_first[i], sizeof(int));
        }

        for (int i = 0; i < ch_num; i++) {
            res.append((const char*)&ch_second[i], sizeof(int));
        }

        res.append((const char*)&fa, sizeof(int));
        res.append((const char*)&fa_ch, sizeof(int));

        res.append((const char*)&fail, sizeof(int));
        res.append((const char*)&last, sizeof(int));
        res.append((const char*)&len, sizeof(int));

        int code_num = codes.size();
        res.append((const char*)&code_num, sizeof(int));
        for (int i = 0; i < code_num; i++) {
            res.append(codes[i].save());
        }

        return res;
    }
};
/*


int ch_sz;                   0


ch_sz个char32_t              1*sizeof(int)
ch_sz个int                   (1+ch_sz) * sizeof(int)
int fa;                     (1+2*ch_sz)*sizeof(int)
char32_t fa_ch;             (2+2*ch_sz)*sizeof(int)
int fail;                    (3+2*ch_sz) * sizeof(int)
int last;                    (4+2*ch_sz) * sizeof(int)
int len;                     (5+2*ch_sz) * sizeof(int)
int code_sz;                 (6+2*ch_sz) * sizeof(int)
code_sz个Code                (7+2*ch_sz) * sizeof(int)


*/

struct WordTrieNodeReader {
    void* p;
    int get_ch_sz() const {
        int ch_sz = *(int*)p;
        return ch_sz;
    }

    std::pair<char32_t, int> get_ch_with_rk(int rk) const {
        int ch_sz = *(int*)p;
        int* pp = (int*)p + 1;
        if (rk < 0 || rk >= ch_sz) return {U'\0', -1};
        return {*((char32_t*)pp + rk), *((int*)pp + ch_sz + rk)};
    }

    int get_ch(char32_t ch) const {
        int ch_sz;
        int tmp;
        ch_sz = *(int*)p;
        int* pp = (int*)p + 1;
        int l = 0, r = ch_sz;
        int ed = ch_sz;
        while (l < r) {
            int mid = l + r >> 1;
            tmp = *((int*)pp + mid);
            if (tmp < ch) {
                l = mid + 1;
            } else {
                r = mid;
            }
        }
        if (l == ed) return -1;
        tmp = *((int*)pp + l);
        if (tmp != ch) return -1;
        tmp = *((int*)pp + ch_sz + l);
        return tmp;
    }

    int get_fa() const {
        int ch_sz, tmp;
        ch_sz = *(int*)p;
        tmp = *((int*)p + 1 + 2 * ch_sz);
        return tmp;
    }

    int get_fa_ch() const {
        int ch_sz, tmp;
        ch_sz = *(int*)p;
        tmp = *((int*)p + 2 + 2 * ch_sz);
        return tmp;
    }

    int get_fail() const {
        int ch_sz, tmp;
        ch_sz = *(int*)p;
        tmp = *((int*)p + 3 + 2 * ch_sz);
        return tmp;
    }

    int get_last() const {
        int ch_sz, tmp;
        ch_sz = *(int*)p;
        tmp = *((int*)p + 4 + 2 * ch_sz);
        return tmp;
    }

    int get_len() const {
        int ch_sz, tmp;
        ch_sz = *(int*)p;
        tmp = *((int*)p + 5 + 2 * ch_sz);
        return tmp;
    }

    int get_code_sz() const {
        int ch_sz, tmp;
        ch_sz = *(int*)p;
        tmp = *((int*)p + 6 + 2 * ch_sz);
        return tmp;
    }

    CodeReader get_code(int u) const {
        int ch_sz;
        CodeReader res;
        ch_sz = *(int*)p;
        res.p = (Code*)((int*)p + 7 + 2 * ch_sz) + u;
        return res;
    }
};

struct WordTrie {
    std::vector<WordTrieNode> nodes;

    void init() {
        nodes.clear();
        nodes.push_back(WordTrieNode());
    }

    int insert(const std::u32string& str, const Code& code) {
        int u = 0;
        for (char32_t ch : str) {
            auto it = nodes[u].ch.find(ch);
            if (it == nodes[u].ch.end()) {
                nodes.push_back(WordTrieNode());
                nodes[u].ch[ch] = nodes.size() - 1;
                nodes.back().len = nodes[u].len + 1;
                nodes.back().fa = u;
                nodes.back().fa_ch = ch;
            }
            u = nodes[u].ch[ch];
        }
        nodes[u].codes.push_back(code);

        return u;
    }

    void get_fail() {
        std::queue<int> q;
        nodes[0].fail = 0;

        for (auto it : nodes[0].ch) {
            nodes[it.second].fail = 0;
            nodes[it.second].last = 0;
            q.push(it.second);
        }
        while (!q.empty()) {
            int r = q.front();
            q.pop();

            for (auto it : nodes[r].ch) {
                int u = it.second;
                q.push(u);
                int v = nodes[r].fail;
                while (v && !nodes[v].ch.count(it.first)) v = nodes[v].fail;
                if (nodes[v].ch.count(it.first))
                    nodes[u].fail = nodes[v].ch[it.first];
                else
                    nodes[u].fail = 0;
                nodes[u].last = nodes[nodes[u].fail].codes.size()
                                    ? nodes[u].fail
                                    : nodes[nodes[u].fail].last;
            }
        }
    }

    std::string save() const {
        std::string head, res;
        for (auto& e : nodes) {
            long long offset = res.size() + sizeof(long long) * nodes.size();
            head.append((const char*)&offset, sizeof(long long));
            res.append(e.save());
        }
        return head + res;
    }
};

struct WordTrieReader {
    void* p;
    WordTrieNodeReader get_node(int u) const {
        WordTrieNodeReader ans;
        long long addr;
        addr = *((long long*)p + u);
        ans.p = (void*)((char*)p + addr);
        return ans;
    }

    std::u32string get_word(int u) const {
        std::u32string res;
        while (u) {
            res.push_back(get_node(u).get_fa_ch());
            u = get_node(u).get_fa();
        }
        std::reverse(res.begin(), res.end());
        return res;
    }

    int get_len() const {
        int sz = *((long long*)p) / sizeof(long long);
        return sz;
    }
};

const std::map<char32_t, std::u32string> biaodian = {
    {U'~', U"↑`"},  {U'!', U"↑1"},  {U'@', U"↑2"},  {U'#', U"↑3"},
    {U'$', U"↑4"},  {U'%', U"↑5"},  {U'^', U"↑6"},  {U'&', U"↑7"},
    {U'*', U"↑8"},  {U'(', U"↑9"},  {U')', U"↑0"},  {U'_', U"↑-"},
    {U'+', U"↑="},  {U'～', U"↑`"}, {U'！', U"↑1"}, {U'（', U"↑9"},
    {U'）', U"↑0"}, {U'[', U"["},   {U']', U"]"},   {U'【', U"["},
    {U'】', U"]"},  {U'{', U"↑["},  {U'}', U"↑]"},  {U'｛', U"↑["},
    {U'｝', U"↑]"}, {U'\\', U"\\"}, {U'|', U"↑\\"}, {U';', U";"},
    {U'；', U";"},  {U'：', U"↑;"}, {U':', U"↑;"},  {U'\'', U"'"},
    {U'‘', U"'"},   {U'’', U"'"},   {U'"', U"↑'"},  {U'“', U"↑'"},
    {U'”', U"↑'"},  {U',', U","},   {U'.', U"."},   {U'，', U","},
    {U'。', U"."},  {U'<', U"↑,"},  {U'>', U"↑."},  {U'《', U"↑,"},
    {U'》', U"↑."}, {U'/', U"/"},   {U'?', U"↑/"},  {U'、', U"/"},
    {U'？', U"↑/"}, {U'-', U"-"},   {U'=', U"="}};
const std::map<std::u32string, std::u32string> biaodian2 = {{U"……", U"↑6"},
                                                            {U"——", U"↑-"}};
const std::map<char32_t, std::u32string> inverse_biaodian = {
    {U'[', U"【"}, {U']', U"】"}, {U';', U"；"},
    {U',', U"，"}, {U'.', U"。"}, {U'/', U"、"},
};

const std::map<char32_t, std::u32string> inverse_biaodian_2 = {
    {U'`', U"~"},  {U'1', U"！"}, {U'2', U"@"},  {U'3', U"#"},  {U'4', U"$"},
    {U'5', U"%"},  {U'6', U"……"}, {U'7', U"&"},  {U'8', U"*"},  {U'9', U"（"},
    {U'0', U"）"}, {U'-', U"——"}, {U'=', U"+"},  {U'[', U"｛"}, {U']', U"｝"},
    {U'\\', U"|"}, {U';', U"："}, {U',', U"《"}, {U'.', U"》"}, {U'/', U"？"},
};

struct Config {
    std::vector<char32_t> xuan_chong;
    int max_len;
    std::set<char32_t> punct;
    std::set<char32_t> code_elem;

    void set_default() {
        xuan_chong = {U'_', U';', U'\'', U'4', U'5',
                      U'6', U'7', U'8',  U'9', U'0'};
        punct = {};
        max_len = 4;
    }

    std::string save() const {
        int tmp;
        std::string res;

        tmp = xuan_chong.size();
        res.append((const char*)&tmp, sizeof(int));
        for (int i = 0; i < xuan_chong.size(); i++) {
            res.append((const char*)&xuan_chong[i], sizeof(int));
        }

        res.append((const char*)&max_len, sizeof(int));

        tmp = punct.size();
        res.append((const char*)&tmp, sizeof(int));
        for (auto e : punct) {
            res.append((const char*)&e, sizeof(int));
        }

        tmp = code_elem.size();
        res.append((const char*)&tmp, sizeof(int));
        for (auto e : code_elem) {
            res.append((const char*)&e, sizeof(int));
        }
        return res;
    }

    void load(const std::string& byte) {
        const char* p = byte.data();

        xuan_chong.resize(*(const int*)p);
        p += sizeof(int);
        for (int i = 0; i < xuan_chong.size(); i++) {
            xuan_chong[i] = *(int*)p;
            p += sizeof(int);
        }

        max_len = *(const int*)p;
        p += sizeof(int);

        int tmp = *(const int*)p;
        p += sizeof(int);
        for (int i = 0; i < tmp; i++) {
            punct.insert(*(const int*)p);
            p += sizeof(int);
        }

        tmp = *(const int*)p;
        p += sizeof(int);
        for (int i = 0; i < tmp; i++) {
            code_elem.insert(*(const int*)p);
            p += sizeof(int);
        }
    }
};

struct Data {
    CodeTrie code_trie;
    WordTrie word_trie;
    Config config;

    void insert(const std::u32string& code, const std::u32string& word) {
        int code_node_id = code_trie.insert(code);
        Code code_node = {.code = code_node_id,
                          .index = code_trie.nodes[code_node_id].num};
        int word_node_id = word_trie.insert(word, code_node);
        code_trie.nodes[code_node_id].word_id.push_back(word_node_id);
        for (auto ch : code) config.code_elem.insert(ch);
    }

    void pre_calculate() { word_trie.get_fail(); }

    std::string save() const {
        std::string head;
        std::string res;
        long long offset;

        offset = res.size() + sizeof(long long) * 2;
        head.append((const char*)&offset, sizeof(long long));
        res.append(code_trie.save());

        offset = res.size() + sizeof(long long) * 2;
        head.append((const char*)&offset, sizeof(long long));
        res.append(word_trie.save());

        return head + res;
    }
};

unsigned long get_file_size(const char* path) {
    unsigned long filesize = -1;
    struct stat statbuff;
    if (stat(path, &statbuff) < 0) {
        return filesize;
    } else {
        filesize = statbuff.st_size;
    }
    return filesize;
}

struct DataReader {
    // FILE* fp;
    // long long offset;
    Config config;
    void* p = nullptr;
    size_t len = 0;

    bool load_hint(const std::string& filename) {
        p = nullptr;
        int fd = open(filename.c_str(), O_RDONLY);
        if (fd == -1) return false;
        len = get_file_size(filename.c_str());
        p = mmap(NULL, len, PROT_READ, MAP_SHARED, fd, 0);
        close(fd);
        if (p == MAP_FAILED) return false;
        return true;
    }

    void unload_hint() {
        if (p != MAP_FAILED && p) {
            munmap(p, len);
        }
    }

    bool load_config(const std::string& filename) {
        FILE* fp = fopen(filename.c_str(), "rb");
        if (!fp) return false;
        std::string res;
        int ch;
        while ((ch = fgetc(fp)) != EOF) {
            res.push_back(ch);
        }
        config.load(res);
        fclose(fp);
        return true;
    }

    CodeTrieReader get_code_trie() const {
        CodeTrieReader ans;
        long long addr;
        // fseek(fp, offset, SEEK_SET);
        // fread(&addr, sizeof(long long), 1, fp);
        addr = *(long long*)p;
        // ans.fp = fp;
        // ans.offset = offset + addr;
        ans.p = (void*)((char*)p + addr);
        return ans;
    }

    WordTrieReader get_word_trie() const {
        WordTrieReader ans;
        long long addr;
        // fseek(fp, offset + sizeof(long long), SEEK_SET);
        // fread(&addr, sizeof(long long), 1, fp);
        addr = *((long long*)p + 1);
        // ans.fp = fp;
        // ans.offset = offset + addr;
        ans.p = (void*)((char*)p + addr);
        return ans;
    }
};

int get_type(int code_len, int word_len) {
    if (word_len <= 1) return 0;
    if (code_len == 1) return 1;
    if (code_len == 2) return 2;
    if (code_len == 3) return 3;
    return 4;
}

struct Pair {
    std::u32string code;
    int pos;
    std::u32string word;
    bool operator<(const Pair& rhs) const {
        return code.size() < rhs.code.size() ||
               code.size() == rhs.code.size() &&
                   (code < rhs.code || code == rhs.code && pos < rhs.pos);
    }
};

struct Show {
    std::u32string word;
    std::u32string code;
    int type;
    int is_chong;
    int is_que;
};
struct Answer {
    std::vector<Show> ans;
    double code_len;
    int chongshu;
    int queshu;
};
struct SimpleCode {
    std::u32string code;
    int index;
    std::u32string display_word;

    bool operator<(const SimpleCode& rhs) const {
        return code < rhs.code ||
               code == rhs.code &&
                   (index < rhs.index ||
                    index == rhs.index && display_word < rhs.display_word);
    }
};
struct SimpleAnswer {
    std::u32string word;
    std::vector<SimpleCode> code;
};
struct SearchTerm {
    std::u32string word;
    std::u32string display_code;
};
struct SearchAnswer {
    std::u32string code;
    std::vector<SearchTerm> term;
};

struct Node {
    int x, y;
    std::u32string code;
    std::u32string word;
    int is_chong;
    int type;
};

struct Solve {
    DataReader data;
    ~Solve() { data.unload_hint(); }
    struct DPNode {
        int len;
        int chong;
        int que;
        bool operator<(const DPNode& rhs) const {
            return que < rhs.que ||
                   que == rhs.que &&
                       (len < rhs.len || len == rhs.len && chong < rhs.chong);
        }
        DPNode operator+(const DPNode& rhs) const {
            return {len + rhs.len, chong + rhs.chong, que + rhs.que};
        }
    };
    struct EdgeInfo {
        std::u32string code;
        std::u32string word;
        int is_chong;
        int type;
        int is_que;
    };
    struct Edge {
        int x;
        int y;

        EdgeInfo info;
    };

    std::vector<std::vector<DPNode>> dp;
    std::vector<std::vector<Edge>> fa;

    bool can_ding(int dp_node, const std::u32string& chs) {
        if (dp_node == 0) return true;
        for (auto& ch : chs) {
            bool is_xuanchong = std::find(data.config.xuan_chong.begin(),
                                          data.config.xuan_chong.end(),
                                          ch) != data.config.xuan_chong.end();
            if (!is_xuanchong && ch != U'=') {
                return true;
            } else {
                return false;
            }
        }
        return false;
    }

    // dp[i1][j1] <- dp[i2][j2]
    void update(int i1, int j1, int i2, int j2, DPNode dpnode, EdgeInfo info) {
        if (dp[i2][j2].len == 0x3fffffff || dp[i2][j2].chong == 0x3fffffff) {
            return;
        }
        if (dp[i1][j1].len == 0x3fffffff || dp[i1][j1].chong == 0x3fffffff ||
            dp[i2][j2] + dpnode < dp[i1][j1]) {
            dp[i1][j1] = dp[i2][j2] + dpnode;
            fa[i1][j1] = {i2, j2, info};
        }
    }

    void transfer(const std::u32string& article, int i, int j, int node_num) {
        std::u32string substr = article.substr(i - j, j);
        WordTrieNodeReader wtnr = data.get_word_trie().get_node(node_num);
        CodeTrieReader ctr = data.get_code_trie();
        // 该词条的打法种数
        int code_method_size = wtnr.get_code_sz();
        for (int p = 0; p < code_method_size; p++) {
            CodeReader cr = wtnr.get_code(p);
            int code_id = cr.get_code();
            int candidate_pos = cr.get_index();
            int page = (candidate_pos - 1) / data.config.xuan_chong.size();
            int xuanchong =
                (candidate_pos - 1) % data.config.xuan_chong.size() + 1;
            int is_chong = !(page == 0 && xuanchong == 1);
            std::u32string raw_code = ctr.get_code(code_id);
            int raw_code_len = raw_code.size();
            CodeTrieNodeReader ctnr = ctr.get_node(code_id);
            int code_num = ctnr.get_num();
            int code_sum = ctnr.get_sum();
            int type = get_type(raw_code_len, j);
            int dp_node;
            // 标点引导键
            bool is_punct =
                data.config.punct.find(raw_code[0]) != data.config.punct.end();

            if (data.config.max_len > 0) {
                if (code_id == 0) {
                    dp_node = 0;
                } else if (raw_code_len >= data.config.max_len) {
                    dp_node = 1;
                } else {
                    dp_node = 2;
                }
                // 0:无候选 1:有候选，可以编码顶 2:有候选，只可标点顶
                for (int q = 2; q >= 0; q--) {
                    if (!can_ding(q, raw_code)) continue;
                    if (is_punct) {
                        if (code_num == code_sum && code_num == 1) {
                            // 唯一上屏
                            update(i, 0, i - j, q, {raw_code_len, is_chong},
                                   {raw_code, substr, is_chong, type, 0});
                        } else {
                            if (xuanchong == 1) {
                                // 选重为1，可顶
                                update(i, dp_node, i - j, q,
                                       {raw_code_len + page, is_chong},
                                       {raw_code + std::u32string(page, U'='),
                                        substr, is_chong, type, 0});
                            }
                            // 选重上屏
                            update(
                                i, 0, i - j, q,
                                {raw_code_len + page + 1, is_chong},
                                {raw_code + std::u32string(page, U'=') +
                                     std::u32string(
                                         1,
                                         data.config.xuan_chong[xuanchong - 1]),
                                 substr, is_chong, type, 0});
                        }
                    } else {
                        // 不可编码顶
                        if (q == 2) continue;
                        if (code_num == code_sum && code_num == 1 &&
                            raw_code_len >= data.config.max_len) {
                            // 唯一上屏
                            update(i, 0, i - j, q, {raw_code_len, is_chong},
                                   {raw_code, substr, is_chong, type, 0});
                        } else {
                            if (xuanchong == 1) {
                                // 选重为1，可顶
                                update(i, dp_node, i - j, q,
                                       {raw_code_len + page, is_chong},
                                       {raw_code + std::u32string(page, U'='),
                                        substr, is_chong, type, 0});
                            }
                            // 选重上屏
                            update(
                                i, 0, i - j, q,
                                {raw_code_len + page + 1, is_chong},
                                {raw_code + std::u32string(page, U'=') +
                                     std::u32string(
                                         1,
                                         data.config.xuan_chong[xuanchong - 1]),
                                 substr, is_chong, type, 0});
                        }
                    }
                }
            } else if (data.config.max_len == 0) {
                // 唯一上屏
                update(i, 0, i - j, 0, {raw_code_len, 0},
                       {raw_code, substr, is_chong, type, 0});
            } else {
                if (code_id == 0) {
                    dp_node = 0;
                } else {
                    dp_node = 1;
                }
                // 0:无候选 1:有候选，可以编码顶 2:有候选，只可标点顶
                for (int q = 2; q >= 0; q--) {
                    int ntype = type, nis_chong = 0;
                    // 识别选重
                    if (raw_code.size()) {
                        for (int tt = 1; tt < data.config.xuan_chong.size();
                             tt++) {
                            if (data.config.xuan_chong[tt] == raw_code.back()) {
                                nis_chong = 1;
                            }
                        }
                        if (nis_chong ||
                            !data.config.xuan_chong.empty() &&
                                data.config.xuan_chong[0] == raw_code.back()) {
                            ntype = get_type(raw_code_len - 1, j);
                        }
                    }

                    if (is_punct) {
                        if (code_num == code_sum && code_num == 1) {
                            // 唯一上屏
                            update(i, 0, i - j, q, {raw_code_len, nis_chong},
                                   {raw_code, substr, nis_chong, ntype, 0});
                        } else {
                            if (xuanchong == 1) {
                                // 选重为1，可顶
                                update(i, dp_node, i - j, q,
                                       {raw_code_len + page, is_chong},
                                       {raw_code + std::u32string(page, U'='),
                                        substr, is_chong, type, 0});
                            }
                            // 选重上屏
                            update(
                                i, 0, i - j, q,
                                {raw_code_len + page + 1, is_chong},
                                {raw_code + std::u32string(page, U'=') +
                                     std::u32string(
                                         1,
                                         data.config.xuan_chong[xuanchong - 1]),
                                 substr, is_chong, type, 0});
                        }
                    } else {
                        // 不可编码顶
                        if (q == 2) continue;
                        if (code_num == code_sum && code_num == 1) {
                            // 唯一上屏
                            update(i, 0, i - j, q, {raw_code_len, nis_chong},
                                   {raw_code, substr, nis_chong, ntype, 0});
                        } else {
                            if (xuanchong == 1) {
                                // 选重为1，可顶
                                update(i, dp_node, i - j, q,
                                       {raw_code_len + page, is_chong},
                                       {raw_code + std::u32string(page, U'='),
                                        substr, is_chong, type, 0});
                            }
                            // 选重上屏
                            update(
                                i, 0, i - j, q,
                                {raw_code_len + page + 1, is_chong},
                                {raw_code + std::u32string(page, U'=') +
                                     std::u32string(
                                         1,
                                         data.config.xuan_chong[xuanchong - 1]),
                                 substr, is_chong, type, 0});
                        }
                        // 识别顶功
                        if (raw_code.size() &&
                            !data.config.xuan_chong.empty() &&
                            raw_code.back() == data.config.xuan_chong[0]) {
                            int tmp_dp_node = 0;
                            if (ctnr.get_fa() != 0) {
                                tmp_dp_node = 2;
                            }
                            update(i, tmp_dp_node, i - j, q,
                                   {raw_code_len - 1, 0},
                                   {raw_code.substr(0, raw_code.size() - 1),
                                    substr, 0, type, 0});
                        }
                    }
                }
            }
        }
    }
    Answer solve(const std::u32string& article) {
        // 初始化dp
        int len = article.size();
        int num_of_state = 0;
        if (data.config.max_len == 0) {
            num_of_state = 1;
        } else {
            num_of_state = 3;
        }
        dp.resize(len + 1, std::vector<DPNode>(num_of_state,
                                               DPNode{0x3fffffff, 0x3fffffff}));
        fa.resize(len + 1, std::vector<Edge>(num_of_state));

        dp[0][0] = {0, 0};
        auto word_trie = data.get_word_trie();
        // dp转移
        int j = 0;
        for (int i = 1; i <= len; i++) {
            // 词库转移
            char32_t c = article[i - 1];
            while (j && word_trie.get_node(j).get_ch(c) == -1)
                j = word_trie.get_node(j).get_fail();

            if (word_trie.get_node(j).get_ch(c) != -1) {
                j = word_trie.get_node(j).get_ch(c);
            } else {
                j = 0;
            }
            bool flag = false;

            if (word_trie.get_node(j).get_code_sz()) {
                transfer(article, i, word_trie.get_node(j).get_len(), j);
            }
            for (int k = j; word_trie.get_node(k).get_last();
                 k = word_trie.get_node(k).get_last()) {
                transfer(article, i,
                         word_trie.get_node(word_trie.get_node(k).get_last())
                             .get_len(),
                         word_trie.get_node(k).get_last());
            }

            if (data.config.max_len == 0 &&
                data.config.xuan_chong.size() == 1 &&
                data.config.xuan_chong[0] == U'\0') {
                continue;
            }
            // 一位标点转移
            char32_t ch = article[i - 1];
            auto pos = biaodian.find(ch);

            if (pos != biaodian.end()) {
                for (int q = num_of_state - 1; q >= 0; q--) {
                    if (!can_ding(q, pos->second) && data.config.max_len != 0) {
                        continue;
                    }
                    if (data.config.code_elem.count(pos->second[0])) {
                        continue;
                    }
                    std::u32string tmp = pos->second;
                    update(i, 0, i - 1, q, {(int)tmp.size(), 0},
                           {tmp, std::u32string(1, ch), 0, 0, 0});
                }
            }

            // 两位标点转移
            if (i >= 2) {
                std::u32string str = article.substr(i - 2, 2);
                auto pos2 = biaodian2.find(str);
                if (pos2 != biaodian2.end()) {
                    for (int q = num_of_state - 1; q >= 0; q--) {
                        if (!can_ding(q, pos2->second) &&
                            data.config.max_len != 0) {
                            continue;
                        }
                        if (data.config.code_elem.count(pos2->second[0])) {
                            continue;
                        }
                        std::u32string tmp = pos2->second;
                        update(i, 0, i - 2, q, {(int)tmp.size(), 0},
                               {tmp, str, 0, 0, 0});
                    }
                }
            }

            // 字母空格数字转移
            {
                char32_t word = ch;
                std::u32string tmp;
                int style = 0;
                if (ch >= 'A' && ch <= 'Z') {
                    tmp = std::u32string(1, ch - 'A' + 'a');
                } else if (ch == ' ') {
                    tmp = std::u32string(1, '_');
                } else if (ch >= 'a' && ch <= 'z' || ch >= '0' && ch <= '9') {
                    tmp = std::u32string(1, ch);
                } else {
                    goto do_nothing;
                }
                update(i, 0, i - 1, 0, {(int)tmp.size(), 0},
                       {tmp, std::u32string(1, word), 0, style, 0});
            do_nothing:;
            }
            if (dp[i][0].len == 0x3fffffff || dp[i][0].chong == 0x3fffffff) {
                // 一位标点转移
                char32_t ch = article[i - 1];
                auto pos = biaodian.find(ch);

                if (pos != biaodian.end()) {
                    for (int q = num_of_state - 1; q >= 0; q--) {
                        if (!can_ding(q, pos->second) &&
                            data.config.max_len != 0) {
                            continue;
                        }
                        std::u32string tmp = pos->second;
                        update(i, 0, i - 1, q, {(int)tmp.size(), 0},
                               {tmp, std::u32string(1, ch), 0, 0, 0});
                    }
                }

                // 两位标点转移
                if (i >= 2) {
                    std::u32string str = article.substr(i - 2, 2);
                    auto pos2 = biaodian2.find(str);
                    if (pos2 != biaodian2.end()) {
                        for (int q = num_of_state - 1; q >= 0; q--) {
                            if (!can_ding(q, pos2->second) &&
                                data.config.max_len != 0) {
                                continue;
                            }
                            std::u32string tmp = pos2->second;
                            update(i, 0, i - 2, q, {(int)tmp.size(), 0},
                                   {tmp, str, 0, 0, 0});
                        }
                    }
                }
            }

            if (dp[i][0].len == 0x3fffffff || dp[i][0].chong == 0x3fffffff) {
                std::u32string tmp = U"??????";
                int style = 5;
                update(i, 0, i - 1, 0, {(int)tmp.size(), 1},
                       {tmp, std::u32string(1, ch), 0, style, 1});
            }
        }

        // 整理结果
        double code_len = 0;
        int chongshu = 0;
        int queshu = 0;
        std::stack<Show> res;

        code_len = (double)dp[len][0].len / len;
        {
            int i = len, ni = 0;
            int j = 0, nj = 0;

            for (; i; i = ni, j = nj) {
                res.push({fa[i][j].info.word, fa[i][j].info.code,
                          fa[i][j].info.type, fa[i][j].info.is_chong,
                          fa[i][j].info.is_que});
                chongshu += fa[i][j].info.is_chong;
                queshu += fa[i][j].info.is_que;
                ni = fa[i][j].x;
                nj = fa[i][j].y;
            }
        }

        Answer ret;
        ret.code_len = code_len;
        for (; !res.empty(); res.pop()) {
            ret.ans.push_back(res.top());
        }
        ret.chongshu = chongshu;
        ret.queshu = queshu;
        return ret;
    }

    Answer solve_one(const std::u32string& article) {
        // 初始化dp
        int len = article.size();
        int num_of_state = 0;
        if (data.config.max_len == 0) {
            num_of_state = 1;
        } else {
            num_of_state = 3;
        }
        dp.resize(len + 1, std::vector<DPNode>(num_of_state,
                                               DPNode{0x3fffffff, 0x3fffffff}));
        fa.resize(len + 1, std::vector<Edge>(num_of_state));

        dp[0][0] = {0, 0};
        auto word_trie = data.get_word_trie();
        // dp转移
        int j = 0;
        for (int i = 1; i <= len; i++) {
            // 词库转移
            char32_t c = article[i - 1];
            while (j && word_trie.get_node(j).get_ch(c) == -1)
                j = word_trie.get_node(j).get_fail();

            if (word_trie.get_node(j).get_ch(c) != -1) {
                j = word_trie.get_node(j).get_ch(c);
            } else {
                j = 0;
            }
            bool flag = false;

            if (word_trie.get_node(j).get_code_sz()) {
                int len = word_trie.get_node(j).get_len();
                if (len == 1) transfer(article, i, len, j);
            }
            for (int k = j; word_trie.get_node(k).get_last();
                 k = word_trie.get_node(k).get_last()) {
                int len = word_trie.get_node(word_trie.get_node(k).get_last())
                              .get_len();
                if (len == 1)
                    transfer(article, i, len, word_trie.get_node(k).get_last());
            }

            if (data.config.max_len == 0 &&
                data.config.xuan_chong.size() == 1 &&
                data.config.xuan_chong[0] == U'\0') {
                continue;
            }
            char32_t ch = article[i - 1];
            auto pos = biaodian.find(ch);

            if (pos != biaodian.end()) {
                for (int q = num_of_state - 1; q >= 0; q--) {
                    if (!can_ding(q, pos->second) && data.config.max_len != 0) {
                        continue;
                    }
                    if (data.config.code_elem.count(pos->second[0])) {
                        continue;
                    }
                    std::u32string tmp = pos->second;
                    update(i, 0, i - 1, q, {(int)tmp.size(), 0},
                           {tmp, std::u32string(1, ch), 0, 0, 0});
                }
            }

            // 两位标点转移
            if (i >= 2) {
                std::u32string str = article.substr(i - 2, 2);
                auto pos2 = biaodian2.find(str);
                if (pos2 != biaodian2.end()) {
                    for (int q = num_of_state - 1; q >= 0; q--) {
                        if (!can_ding(q, pos2->second) &&
                            data.config.max_len != 0) {
                            continue;
                        }
                        if (data.config.code_elem.count(pos2->second[0])) {
                            continue;
                        }
                        std::u32string tmp = pos2->second;
                        update(i, 0, i - 2, q, {(int)tmp.size(), 0},
                               {tmp, str, 0, 0, 0});
                    }
                }
            }

            // 字母空格数字转移
            {
                char32_t word = ch;
                std::u32string tmp;
                int style = 0;
                if (ch >= 'A' && ch <= 'Z') {
                    tmp = std::u32string(1, ch - 'A' + 'a');
                } else if (ch == ' ') {
                    tmp = std::u32string(1, '_');
                } else if (ch >= 'a' && ch <= 'z' || ch >= '0' && ch <= '9') {
                    tmp = std::u32string(1, ch);
                } else {
                    goto do_nothing;
                }
                update(i, 0, i - 1, 0, {(int)tmp.size(), 0},
                       {tmp, std::u32string(1, word), 0, style, 0});

            do_nothing:;
            }
            if (dp[i][0].len == 0x3fffffff || dp[i][0].chong == 0x3fffffff) {
                // 一位标点转移
                char32_t ch = article[i - 1];
                auto pos = biaodian.find(ch);

                if (pos != biaodian.end()) {
                    for (int q = num_of_state - 1; q >= 0; q--) {
                        if (!can_ding(q, pos->second) &&
                            data.config.max_len != 0) {
                            continue;
                        }
                        std::u32string tmp = pos->second;
                        update(i, 0, i - 1, q, {(int)tmp.size(), 0},
                               {tmp, std::u32string(1, ch), 0, 0, 0});
                    }
                }

                // 两位标点转移
                if (i >= 2) {
                    std::u32string str = article.substr(i - 2, 2);
                    auto pos2 = biaodian2.find(str);
                    if (pos2 != biaodian2.end()) {
                        for (int q = num_of_state - 1; q >= 0; q--) {
                            if (!can_ding(q, pos2->second) &&
                                data.config.max_len != 0) {
                                continue;
                            }
                            std::u32string tmp = pos2->second;
                            update(i, 0, i - 2, q, {(int)tmp.size(), 0},
                                   {tmp, str, 0, 0, 0});
                        }
                    }
                }
            }

            if (dp[i][0].len == 0x3fffffff || dp[i][0].chong == 0x3fffffff) {
                std::u32string tmp = U"??????";
                int style = 5;
                update(i, 0, i - 1, 0, {(int)tmp.size(), 1},
                       {tmp, std::u32string(1, ch), 0, style, 1});
            }
        }

        // 整理结果
        double code_len = 0;
        int chongshu = 0;
        int queshu = 0;
        std::stack<Show> res;

        code_len = (double)dp[len][0].len / len;
        {
            int i = len, ni = 0;
            int j = 0, nj = 0;

            for (; i; i = ni, j = nj) {
                res.push({fa[i][j].info.word, fa[i][j].info.code,
                          fa[i][j].info.type, fa[i][j].info.is_chong,
                          fa[i][j].info.is_que});
                chongshu += fa[i][j].info.is_chong;
                queshu += fa[i][j].info.is_que;
                ni = fa[i][j].x;
                nj = fa[i][j].y;
            }
        }

        Answer ret;
        ret.code_len = code_len;
        for (; !res.empty(); res.pop()) {
            ret.ans.push_back(res.top());
        }
        ret.chongshu = chongshu;
        ret.queshu = queshu;
        return ret;
    }

    bool has_word(const std::u32string& word) {
        auto word_trie = data.get_word_trie();
        int u = 0;
        for (int i = 0; i < word.size(); i++) {
            u = word_trie.get_node(u).get_ch(word[i]);
            if (u == -1) {
                return false;
            }
        }

        int num_dafa = word_trie.get_node(u).get_code_sz();
        return num_dafa > 0;
    }

    SimpleAnswer solve_simple(const std::u32string& word) {
        // std::u32string tmp = word.substr(0, 1);
        std::vector<SimpleCode> term;
        // char32_t ch = word[0];
        auto word_trie = data.get_word_trie();
        auto code_trie = data.get_code_trie();
        int sz = word_trie.get_len();
        std::vector<int> vis(sz);
        std::vector<std::pair<int, std::u32string>> ans;
        std::vector<int> now_word;
        int cnt = 0;
        auto dfs = [&](auto&& self, int u, int i, bool is_escape) {
            if (vis[u]) return;

            bool tmp_cond;
            if (i >= word.size()) {
                std::u32string word_display;
                for (auto e : now_word) {
                    if (e == -1) {
                        word_display.push_back(U'~');
                    } else if (e == 0) {
                        continue;
                    } else {
                        if (e == U'~' || e == U'\\')
                            word_display.push_back(U'\\');
                        word_display.push_back(e);
                    }
                }
                if (word_display == U"~") word_display = U"";
                ans.push_back({u, word_display});
                return;
            }
            if (is_escape ||
                word[i] != U'*' && word[i] != U'?' && word[i] != U'\\') {
                vis[u] = 1;
                int nxt_u = word_trie.get_node(u).get_ch(word[i]);
                if (nxt_u == -1) {
                    return;
                }
                tmp_cond = now_word.empty() || now_word.back() != -1;
                if (tmp_cond) now_word.push_back(-1);
                self(self, nxt_u, i + 1, false);
                if (tmp_cond) now_word.pop_back();
            } else if (word[i] == U'\\') {
                self(self, u, i + 1, true);
            } else {
                if (word[i] == U'*') {
                    tmp_cond = now_word.empty() || now_word.back() != 0;
                    if (tmp_cond) now_word.push_back(0);
                    self(self, u, i + 1, false);
                    if (tmp_cond) now_word.pop_back();
                }
                vis[u] = 1;
                int nxt_i = i;
                if (word[i] == U'?') nxt_i = i + 1;
                int ch_sz = word_trie.get_node(u).get_ch_sz();
                for (int j = 0; j < ch_sz; j++) {
                    auto res = word_trie.get_node(u).get_ch_with_rk(j);
                    if (res.second == -1) {
                        continue;
                    }
                    now_word.push_back(res.first);
                    self(self, res.second, nxt_i, false);
                    now_word.pop_back();
                }
            }
        };
        dfs(dfs, 0, 0, false);
        for (auto& e : ans) {
            int sz = word_trie.get_node(e.first).get_code_sz();
            for (int i = 0; i < sz; i++) {
                auto tmp = word_trie.get_node(e.first).get_code(i);
                int trie_id = tmp.get_code();
                int index = tmp.get_index();
                term.push_back({code_trie.get_code(trie_id), index, e.second});
            }
        }
        return {word, term};
        // int u = 0;
        // for (int i = 0; i < word.size(); i++) {
        //     u = word_trie.get_node(u).get_ch(word[i]);
        //     if (u == -1) {
        //         return {word, code};
        //     }
        // }

        // int num_dafa = word_trie.get_node(u).get_code_sz();
        // for (int i = 0; i < num_dafa; i++) {
        //     auto tmp = word_trie.get_node(u).get_code(i);
        //     int trie_id = tmp.get_code();
        //     int index = tmp.get_index();
        //     code.push_back({code_trie.get_code(trie_id), index});
        // }

        // return {word, code};
    }
#ifndef NO_NAPI
    std::vector<SimpleCode> solve_simple_func(const Napi::Function& func) {
        auto word_trie = data.get_word_trie();
        auto code_trie = data.get_code_trie();
        std::u32string now_str;
        std::vector<SimpleCode> term;
        auto dfs = [&](auto&& self, int u) -> void {
            if (is_full_match(now_str, func)) {
                int sz = word_trie.get_node(u).get_code_sz();
                for (int i = 0; i < sz; i++) {
                    auto tmp = word_trie.get_node(u).get_code(i);
                    int trie_id = tmp.get_code();
                    int index = tmp.get_index();
                    term.push_back(
                        {code_trie.get_code(trie_id), index, now_str});
                }
            }
            int ch_sz = word_trie.get_node(u).get_ch_sz();
            for (int j = 0; j < ch_sz; j++) {
                auto res = word_trie.get_node(u).get_ch_with_rk(j);
                if (res.second == -1) {
                    continue;
                }
                now_str.push_back(res.first);
                self(self, res.second);
                now_str.pop_back();
            }
        };
        dfs(dfs, 0);
        return term;
    }
#endif

    SearchAnswer solve_search(const std::u32string& code) {
        std::vector<SearchTerm> term;
        auto code_trie = data.get_code_trie();
        auto word_trie = data.get_word_trie();
        int sz = code_trie.get_len();
        std::vector<int> vis(sz);
        std::vector<std::pair<int, std::u32string>> ans;
        std::vector<int> now_code;
        auto dfs = [&](auto&& self, int u, int i, bool is_escape) {
            if (vis[u]) return;
            bool tmp_cond;
            if (i >= code.size()) {
                std::u32string code_display;
                for (auto e : now_code) {
                    if (e == -1) {
                        code_display.push_back(U'~');
                    } else if (e == 0) {
                        continue;
                    } else {
                        if (e == U'~' || e == U'\\')
                            code_display.push_back(U'\\');
                        code_display.push_back(e);
                    }
                }
                if (code_display == U"~") code_display = U"";
                ans.push_back({u, code_display});
                return;
            }
            if (is_escape ||
                code[i] != U'*' && code[i] != U'?' && code[i] != U'\\') {
                vis[u] = 1;
                int nxt_u = code_trie.get_node(u).get_ch(code[i]);
                if (nxt_u == -1) {
                    return;
                }
                tmp_cond = now_code.empty() || now_code.back() != -1;
                if (tmp_cond) now_code.push_back(-1);
                self(self, nxt_u, i + 1, false);
                if (tmp_cond) now_code.pop_back();
            } else if (code[i] == U'\\') {
                self(self, u, i + 1, true);
            } else {
                if (code[i] == U'*') {
                    tmp_cond = now_code.empty() || now_code.back() != 0;
                    if (tmp_cond) now_code.push_back(0);
                    self(self, u, i + 1, false);
                    if (tmp_cond) now_code.pop_back();
                }
                vis[u] = 1;
                int nxt_i = i;
                if (code[i] == U'?') nxt_i = i + 1;
                int ch_sz = code_trie.get_node(u).get_ch_sz();
                for (int j = 0; j < ch_sz; j++) {
                    auto res = code_trie.get_node(u).get_ch_with_rk(j);
                    if (res.second == -1) {
                        continue;
                    }
                    now_code.push_back(res.first);
                    self(self, res.second, nxt_i, false);
                    now_code.pop_back();
                }
            }
        };
        dfs(dfs, 0, 0, false);
        for (auto& e : ans) {
            int sz = code_trie.get_node(e.first).get_word_id_sz();
            for (int i = 0; i < sz; i++) {
                int word_id = code_trie.get_node(e.first).get_word_id(i);
                term.push_back({word_trie.get_word(word_id), e.second});
            }
        }
        return {code, term};

        // for (int i = 0; i < code.size(); i++) {
        //     u = code_trie.get_node(u).get_ch(code[i]);
        //     if (u == -1) {
        //         return {code, word};
        //     }
        // }
        // int sz = code_trie.get_node(u).get_word_id_sz();
        // for (int i = 0; i < sz; i++) {
        //     int word_id = code_trie.get_node(u).get_word_id(i);
        //     word.push_back(word_trie.get_word(word_id));
        // }
        // return {code, word};
    }
#ifndef NO_NAPI
    std::vector<SearchTerm> solve_search_func(const Napi::Function& func) {
        auto word_trie = data.get_word_trie();
        auto code_trie = data.get_code_trie();
        std::u32string now_str;
        std::vector<SearchTerm> term;
        auto dfs = [&](auto&& self, int u) -> void {
            if (is_full_match(now_str, func)) {
                int sz = code_trie.get_node(u).get_word_id_sz();
                for (int i = 0; i < sz; i++) {
                    int word_id = code_trie.get_node(u).get_word_id(i);
                    term.push_back({word_trie.get_word(word_id), now_str});
                }
            }
            int ch_sz = code_trie.get_node(u).get_ch_sz();
            for (int j = 0; j < ch_sz; j++) {
                auto res = code_trie.get_node(u).get_ch_with_rk(j);
                if (res.second == -1) {
                    continue;
                }
                now_str.push_back(res.first);
                self(self, res.second);
                now_str.pop_back();
            }
        };
        dfs(dfs, 0);
        return term;
    }
#endif
#ifndef NO_NAPI
    std::vector<SimpleCode> solve_simple_search_func(
        const Napi::Function& func_simple, const Napi::Function& func_search,
        const Napi::Function& func_chong) {
        auto word_trie = data.get_word_trie();
        auto code_trie = data.get_code_trie();
        std::u32string now_str;
        std::vector<SimpleCode> term;
        auto dfs = [&](auto&& self, int u) -> void {
            if (is_full_match(now_str, func_simple)) {
                int sz = word_trie.get_node(u).get_code_sz();
                for (int i = 0; i < sz; i++) {
                    auto tmp = word_trie.get_node(u).get_code(i);
                    int trie_id = tmp.get_code();
                    int index = tmp.get_index();
                    auto tmp_code = code_trie.get_code(trie_id);
                    if (is_full_match(tmp_code, func_search)) {
                        if (is_full_match(to_utf32(std::to_string(index)),
                                          func_chong)) {
                            term.push_back({tmp_code, index, now_str});
                        }
                    }
                }
            }
            int ch_sz = word_trie.get_node(u).get_ch_sz();
            for (int j = 0; j < ch_sz; j++) {
                auto res = word_trie.get_node(u).get_ch_with_rk(j);
                if (res.second == -1) {
                    continue;
                }
                now_str.push_back(res.first);
                self(self, res.second);
                now_str.pop_back();
            }
        };
        dfs(dfs, 0);
        sort(term.begin(), term.end());
        return term;
    }
#endif

    std::u32string solve_code(const std::u32string& code) {
        int u = 0;
        auto code_trie = data.get_code_trie();
        auto word_trie = data.get_word_trie();
        int now_len = 0;
        int now_offset = 0;
        std::vector<char32_t> state;
        std::u32string res;
        bool is_punct = false;
        std::map<char32_t, int> xuanchong_look_up;
        for (int i = 0; i < data.config.xuan_chong.size(); i++) {
            xuanchong_look_up[data.config.xuan_chong[i]] = i;
        }
        for (int i = 0; i < code.size(); i++) {
            if (!is_punct && u == -1) {
                if (now_len >= data.config.max_len) {
                    u = 0;
                    now_len = 0;
                    now_offset = 0;
                } else {
                    continue;
                }
            }

            int next_u = code_trie.get_node(u).get_ch(code[i]);
            int num_cand = code_trie.get_node(u).get_word_id_sz();
            if (!state.empty() && state.back() == U'↑') {
                state.pop_back();
                if (u > 0) {
                    if (code_trie.get_node(u).get_word_id_sz() > 0) {
                        int word_id =
                            code_trie.get_node(u).get_word_id(now_offset);
                        res += word_trie.get_word(word_id);
                    } else if (data.config.max_len < 0) {
                        int tmp_next_u = code_trie.get_node(u).get_ch(
                            data.config.xuan_chong[0]);
                        if (tmp_next_u > 0 &&
                            code_trie.get_node(tmp_next_u).get_word_id_sz() >
                                0) {
                            u = tmp_next_u;
                            int word_id =
                                code_trie.get_node(u).get_word_id(now_offset);
                            res += word_trie.get_word(word_id);
                        }
                    }
                }

                if (inverse_biaodian_2.count(code[i])) {
                    res += inverse_biaodian_2.at(code[i]);
                } else if (code[i] == U'\'') {
                    if (!state.empty() && state.back() == U'\"') {
                        res += U'”';
                        state.pop_back();
                    } else {
                        res += U'“';
                        state.push_back(U'\"');
                    }
                } else {
                    res += U'↑';
                    res += code[i];
                }

                is_punct = false;
                u = 0;
                now_len = 0;
                now_offset = 0;
                continue;
            }
            if (now_len == 0 &&
                (code[i] == U'_' || code[i] == U' ' || code[i] == U'\t' ||
                 code[i] == U'\n' || code[i] == U'\r' || code[i] == U'\v' ||
                 code[i] == U'\f')) {
                // res += U" ";
                continue;
            }
            if (code[i] == U'↑') {
                state.push_back(code[i]);
                continue;
            }
            if (u == 0 && next_u == -1 && !inverse_biaodian.count(code[i]) &&
                code[i] != '\'') {
                res += code[i];
                continue;
            }
            if (now_len == 0 && data.config.punct.count(code[i])) {
                is_punct = true;
            }
            if (now_len > 0 && xuanchong_look_up.count(code[i])) {
                int pos = xuanchong_look_up[code[i]];
                if (now_offset + pos < num_cand) {
                    int word_id =
                        code_trie.get_node(u).get_word_id(now_offset + pos);
                    res += word_trie.get_word(word_id);
                    is_punct = false;
                    now_offset = 0;
                    now_len = 0;
                    u = 0;
                    continue;
                }
            }
            if (!(data.config.max_len == 0 &&
                  data.config.xuan_chong.size() == 1 &&
                  data.config.xuan_chong[0] == U'\0') &&
                now_len > 0 && code[i] >= U'0' && code[i] <= U'9') {
                int pos = code[i] - U'0';
                if (pos == 0)
                    pos = 10;
                else
                    pos -= 1;
                if (now_offset + pos < num_cand) {
                    int word_id =
                        code_trie.get_node(u).get_word_id(now_offset + pos);
                    res += word_trie.get_word(word_id);
                    is_punct = false;
                    now_offset = 0;
                    now_len = 0;
                    u = 0;
                    continue;
                }
            }
            if (now_len > 0 && code[i] == U'=') {
                now_offset += data.config.xuan_chong.size();
                if (now_offset >= num_cand) {
                    now_offset = 0;
                }
                continue;
            }
            if (!data.config.code_elem.count(code[i]) &&
                !inverse_biaodian.count(code[i]) && code[i] != U'\'') {
                if (u > 0) {
                    if (code_trie.get_node(u).get_word_id_sz() > 0) {
                        int word_id =
                            code_trie.get_node(u).get_word_id(now_offset);
                        res += word_trie.get_word(word_id);
                    } else if (data.config.max_len < 0) {
                        int tmp_next_u = code_trie.get_node(u).get_ch(
                            data.config.xuan_chong[0]);
                        if (tmp_next_u > 0 &&
                            code_trie.get_node(tmp_next_u).get_word_id_sz() >
                                0) {
                            u = tmp_next_u;
                            int word_id =
                                code_trie.get_node(u).get_word_id(now_offset);
                            res += word_trie.get_word(word_id);
                        }
                    }
                }
                if (code[i] != U'_' || !(data.config.max_len == 0 &&
                                         data.config.xuan_chong.size() == 1 &&
                                         data.config.xuan_chong[0] == U'\0')) {
                    res += code[i];
                }
                is_punct = false;
                u = 0;
                now_len = 0;
                now_offset = 0;
                continue;
            }
            if (next_u == -1 && !inverse_biaodian.count(code[i]) &&
                code[i] != U'\'') {
                if (is_punct || now_len >= data.config.max_len) {
                    if (u > 0) {
                        if (code_trie.get_node(u).get_word_id_sz() > 0) {
                            int word_id =
                                code_trie.get_node(u).get_word_id(now_offset);
                            res += word_trie.get_word(word_id);
                        } else if (data.config.max_len < 0) {
                            int tmp_next_u = code_trie.get_node(u).get_ch(
                                data.config.xuan_chong[0]);
                            if (tmp_next_u > 0 &&
                                code_trie.get_node(tmp_next_u)
                                        .get_word_id_sz() > 0) {
                                u = tmp_next_u;
                                int word_id = code_trie.get_node(u).get_word_id(
                                    now_offset);
                                res += word_trie.get_word(word_id);
                            }
                        }
                    }
                    u = 0;
                    now_len = 0;
                    now_offset = 0;
                    i -= 1;
                    is_punct = false;
                    continue;
                } else {
                    u = -1;
                    now_len += 1;
                    now_offset = 0;
                    continue;
                }
            }
            if (next_u == -1 && inverse_biaodian.count(code[i])) {
                if (u > 0) {
                    if (code_trie.get_node(u).get_word_id_sz() > 0) {
                        int word_id =
                            code_trie.get_node(u).get_word_id(now_offset);
                        res += word_trie.get_word(word_id);
                    } else if (data.config.max_len < 0) {
                        int tmp_next_u = code_trie.get_node(u).get_ch(
                            data.config.xuan_chong[0]);
                        if (tmp_next_u > 0 &&
                            code_trie.get_node(tmp_next_u).get_word_id_sz() >
                                0) {
                            u = tmp_next_u;
                            int word_id =
                                code_trie.get_node(u).get_word_id(now_offset);
                            res += word_trie.get_word(word_id);
                        }
                    }
                }
                if (u > 0) {
                    i -= 1;
                } else {
                    res += inverse_biaodian.at(code[i]);
                }
                u = 0;
                now_len = 0;
                now_offset = 0;
                is_punct = false;
                continue;
            }
            if (next_u == -1 && code[i] == U'\'') {
                if (u > 0) {
                    if (code_trie.get_node(u).get_word_id_sz() > 0) {
                        int word_id =
                            code_trie.get_node(u).get_word_id(now_offset);
                        res += word_trie.get_word(word_id);
                    } else if (data.config.max_len < 0) {
                        int tmp_next_u = code_trie.get_node(u).get_ch(
                            data.config.xuan_chong[0]);
                        if (tmp_next_u > 0 &&
                            code_trie.get_node(tmp_next_u).get_word_id_sz() >
                                0) {
                            u = tmp_next_u;
                            int word_id =
                                code_trie.get_node(u).get_word_id(now_offset);
                            res += word_trie.get_word(word_id);
                        }
                    }
                }
                if (u > 0) {
                    i -= 1;
                } else {
                    if (!state.empty() && state.back() == U'\'') {
                        res += U'’';
                        state.pop_back();
                    } else {
                        res += U'‘';
                        state.push_back(U'\'');
                    }
                }
                u = 0;
                now_len = 0;
                now_offset = 0;
                is_punct = false;
                continue;
            }

            now_offset = 0;
            now_len += 1;
            u = next_u;
            if (u > 0) {
                auto node = code_trie.get_node(u);
                if ((is_punct /* || now_len >= data.config.max_len*/) &&
                    node.get_sum() == node.get_num() && node.get_num() == 1) {
                    int word_id = node.get_word_id(0);
                    res += word_trie.get_word(word_id);
                    is_punct = false;
                    u = 0;
                    now_len = 0;
                    now_offset = 0;
                }
            }
        }

        if (u > 0) {
            if (code_trie.get_node(u).get_word_id_sz() > 0) {
                int word_id = code_trie.get_node(u).get_word_id(now_offset);
                res += word_trie.get_word(word_id);
            } else if (data.config.max_len < 0) {
                int tmp_next_u =
                    code_trie.get_node(u).get_ch(data.config.xuan_chong[0]);
                if (tmp_next_u > 0 &&
                    code_trie.get_node(tmp_next_u).get_word_id_sz() > 0) {
                    u = tmp_next_u;
                    int word_id = code_trie.get_node(u).get_word_id(now_offset);
                    res += word_trie.get_word(word_id);
                }
            }
        }
        return res;
    }
};
