// "use strict"
import { createRequire } from 'module';
import { bot, consql } from './bot.js';
import { logger, Structs } from 'node-napcat-ts';
import puppeteer from 'puppeteer';
import { has_reply, get_reply, get_text_content_from_msg } from './util.js';
import fs from 'fs'
import { convertCQCodeToJSON, CQCodeDecode } from 'node-napcat-ts'
import mysql from 'mysql'
import { get_rank } from './rank.js';
import http from 'http'
import { createCipheriv } from 'crypto';
import { runSyncWithTimeout } from "./syncWithTimeout.js";
import { Readable } from 'node:stream';
import { pipeline } from 'stream/promises';
const require = createRequire(import.meta.url);
const word_hint = require('../build/Release/word_hint.node');



// browser.on('targetcreated', async target => {
//   if (target.type() === 'page') {
//     const pages = await browser.pages();
//     console.log('新页面打开，总数:', pages.length);
//   }
// });

// browser.on('targetdestroyed', async target => {
//   if (target.type() === 'page') {
//     const pages = await browser.pages();
//     console.log('页面关闭，总数:', pages.length);
//   }
// });

// const page = await browser.newPage()
const PAGE_NUM = 100
async function word_hint_solve_simple_regular(reg_txt, schema, range = { l: 0, r: 100 }) {
    try {
        let res = await runSyncWithTimeout((reg_txt, schema, range) => {
            const word_hint = require('../build/Release/word_hint.node');
            let now_reg = new RegExp(reg_txt, "u");
            let res = word_hint.solve_simple_func(s => now_reg.test(s), schema, range)
            res.word = reg_txt;
            return res;
        }, [reg_txt, schema, range], 15000)
        return res;

    } catch (e) {
        console.log(e)
        return {
            "word": `${reg_txt}\n正则错误或匹配超时`,
            "code": [],
            "whole_num": 0,
            "l": 0
        };
    }

}

async function word_hint_solve_simple_search_regular(reg_txt, schema, range = { l: 0, r: 100 }) {

    try {
        let reg_txt_simple = reg_txt[0] ?? ""
        let reg_txt_search = reg_txt[1] ?? ""
        let reg_txt_chong = reg_txt[2] ?? ""

        let res = await runSyncWithTimeout((reg_txt_simple, reg_txt_search, reg_txt_chong, schema, range) => {
            const word_hint = require('../build/Release/word_hint.node');
            let now_reg_simple = new RegExp(reg_txt_simple, "u");
            let now_reg_search = new RegExp(reg_txt_search, "u");
            let now_reg_chong = new RegExp(reg_txt_chong, "u");
            let res = word_hint.solve_simple_search_func(s => now_reg_simple.test(s), s => now_reg_search.test(s), s => now_reg_chong.test(s), schema, range)
            res.word = reg_txt_simple;
            res.code_pattern = reg_txt_search;
            res.chong_pattern = reg_txt_chong;
            return res;
        }, [reg_txt_simple, reg_txt_search, reg_txt_chong, schema, range], 15000)
        return res;

    } catch (e) {
        console.log(e)
        return {
            "word": `正则错误或匹配超时`,
            "code_pattern": ``,
            "chong_pattern": ``,
            "code": [],
            "whole_num": 0,
            "l": 0
        };
    }

}

async function word_hint_solve_search_regular(reg_txt, schema, range = { l: 0, r: 100 }) {
    try {
        let res = await runSyncWithTimeout((reg_txt, schema, range) => {
            const word_hint = require('../build/Release/word_hint.node');
            let now_reg = new RegExp(reg_txt, "u");
            let res = word_hint.solve_search_func(s => now_reg.test(s), schema, range)
            res.code = reg_txt;
            return res;
        }, [reg_txt, schema, range], 15000)
        return res;

    } catch (e) {
        console.log(e)
        return {
            "code": `${reg_txt}\n正则错误或匹配超时`,
            "word": [],
            "whole_num": 0,
            "l": 0
        };
    }
}

async function word_hint_get_simple_search_picture(name, from, content, kwargs = {}) {

    const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox'] })
    const page = await browser.newPage()
    try {
        await page.setViewport({
            width: 540,
            height: 1,
            deviceScaleFactor: 2
        });


        await page.goto(`file://${process.cwd()}/simple_search.html`, { waitUntil: 'domcontentloaded' });
        // console.dir(content, {depth: null, maxArrayLength: null})
        await page.evaluate((name, from, content) => {
            document.getElementById('scheme').textContent = `${name}`;
            document.getElementById('source').textContent = `${from}`;
            document.getElementById('head_word').textContent = `${content.word}`
            document.getElementById('head_code_pattern').textContent = `${content.code_pattern}`
            document.getElementById('head_chong_pattern').textContent = `${content.chong_pattern}`

            if (content.l > 0) {
                let num = Math.min(content.l, content.whole_num)
                let node = document.createElement('div');
                node.setAttribute('class', 'term');
                node.textContent = `... 省略前${num}个`
                document.getElementsByClassName('code')[0].appendChild(node);
            }

            for (let i = 0; i < content.code.length; i++) {
                let node = document.createElement('div');
                node.setAttribute('class', 'term');

                if (content.code[i].display_word.length > 0) {
                    node.textContent = `${content.code[i].code}(${content.code[i].index})(${content.code[i].display_word})`
                } else {
                    node.textContent = `${content.code[i].code}(${content.code[i].index})`
                }

                document.getElementsByClassName('code')[0].appendChild(node);
            }

            let node = document.createElement('div');
            node.setAttribute('class', 'term');
            if (content.code.length + content.l < content.whole_num) {
                node.textContent = `...等 共${content.whole_num}个`
            } else {
                node.textContent = `共${content.whole_num}个`
            }
            document.getElementsByClassName('code')[0].appendChild(node);

        }, name, from, content);
        await page.waitForNetworkIdle({ idleTime: 50 })
        // bot.logger.warn(await page.content());
        let res = await page.screenshot({ encoding: 'binary', fullPage: true, type: 'jpeg', quality: 50 });
        // await browser.close();
        await browser.close();
        return res;
    } catch (err) {
        await browser.close();
        console.log(err)
        return null;
    }

}


async function word_hint_get_simple_picture(name, from, content, kwargs = {}) {

    const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox'] })
    const page = await browser.newPage()
    try {
        await page.setViewport({
            width: 540,
            height: 1,
            deviceScaleFactor: 2
        });


        await page.goto(`file://${process.cwd()}/simple.html`, { waitUntil: 'domcontentloaded' });
        // console.dir(content, {depth: null, maxArrayLength: null})
        await page.evaluate((name, from, content) => {
            document.getElementById('scheme').textContent = `${name}`;
            document.getElementById('source').textContent = `${from}`;
            document.getElementsByClassName('head')[0].textContent = `${content.word}`

            if (content.l > 0) {
                let num = Math.min(content.l, content.whole_num)
                let node = document.createElement('div');
                node.setAttribute('class', 'term');
                node.textContent = `... 省略前${num}个`
                document.getElementsByClassName('code')[0].appendChild(node);
            }

            for (let i = 0; i < content.code.length; i++) {
                let node = document.createElement('div');
                node.setAttribute('class', 'term');

                if (content.code[i].display_word.length > 0) {
                    node.textContent = `${content.code[i].code}(${content.code[i].index})(${content.code[i].display_word})`
                } else {
                    node.textContent = `${content.code[i].code}(${content.code[i].index})`
                }

                document.getElementsByClassName('code')[0].appendChild(node);
            }

            let node = document.createElement('div');
            node.setAttribute('class', 'term');
            if (content.code.length + content.l < content.whole_num) {
                node.textContent = `...等 共${content.whole_num}个`
            } else {
                node.textContent = `共${content.whole_num}个`
            }
            document.getElementsByClassName('code')[0].appendChild(node);

        }, name, from, content);
        await page.waitForNetworkIdle({ idleTime: 50 })
        // bot.logger.warn(await page.content());
        let res = await page.screenshot({ encoding: 'binary', fullPage: true, type: 'jpeg', quality: 50 });
        // await browser.close();
        await browser.close();
        return res;
    } catch (err) {
        await browser.close();
        console.log(err)
        return null;
    }



}

async function word_hint_get_search_picture(name, from, content, kwargs = {}) {

    const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox'] })
    const page = await browser.newPage()
    try {
        await page.setViewport({
            width: 540,
            height: 1,
            deviceScaleFactor: 2
        });
        await page.goto(`file://${process.cwd()}/search.html`, { waitUntil: 'domcontentloaded' });
        // console.dir(content, {depth: null, maxArrayLength: null})
        await page.evaluate((name, from, content) => {
            document.getElementById('scheme').textContent = `【${name}】`;
            document.getElementById('source').textContent = `${from}`;
            document.getElementsByClassName('head')[0].textContent = `${content.code}`

            if (content.l > 0) {
                let num = Math.min(content.l, content.whole_num)
                let node = document.createElement('div');
                node.setAttribute('class', 'term');
                node.textContent = `... 省略前${num}个`
                document.getElementsByClassName('code')[0].appendChild(node);
            }

            for (let i = 0; i < content.word.length; i++) {
                let node = document.createElement('div');
                node.setAttribute('class', 'candidate');
                if (content.word[i].display_code.length > 0) {
                    node.textContent = `${i + 1 + content.l}(${content.word[i].display_code}).${content.word[i].word}`
                } else {
                    node.textContent = `${i + 1 + content.l}.${content.word[i].word}`
                }

                document.getElementsByClassName('code')[0].appendChild(node);
            }

            let node = document.createElement('div');
            node.setAttribute('class', 'term');
            if (content.word.length + content.l < content.whole_num) {
                node.textContent = `...等 共${content.whole_num}个`
            } else {
                node.textContent = `共${content.whole_num}个`
            }

            document.getElementsByClassName('code')[0].appendChild(node);

        }, name, from, content);
        await page.waitForNetworkIdle({ idleTime: 50 })
        // bot.logger.warn(await page.content());
        let res = await page.screenshot({ encoding: 'binary', fullPage: true, type: 'jpeg', quality: 50 });
        // await browser.close();
        await browser.close();
        return res;
    } catch (err) {
        console.log(err);
        await browser.close();
        return null;
    }

}


async function word_hint_get_picture(name, from, content, kwargs = {}) {
    let blocks = [];
    for (let i = 0; i < content.show_list.length; i += 600) {
        blocks.push(content.show_list.slice(i, i + 600));
    }

    let run_one_pic = async (name, from, content, is_first) => {
        const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox'] })
        const page = await browser.newPage();
        // const browser = await puppeteer.launch();
        try {
            if (content.show_list.length <= 200) {
                await page.setViewport({
                    width: 540,
                    height: 1,
                    deviceScaleFactor: 2
                });
            } else {
                await page.setViewport({
                    width: 960,
                    height: 1,
                    deviceScaleFactor: 2
                });
            }
            // } else {
            //     await page.setViewport({
            //         width: 1920,
            //         height: 1,
            //         deviceScaleFactor: 2
            //     });
            // }
            await page.goto(`file://${process.cwd()}/word_hint_template.html`, { waitUntil: 'domcontentloaded' });
            await page.evaluate((name, from, content, is_first, kwargs) => {
                document.getElementsByClassName("box_type")[0].textContent = is_first ? `【${name}】` : `【${name}】续`;
                let box_terms = document.getElementsByClassName('box_term');
                let box_terms2 = document.getElementsByClassName('box_term2');
                let box_terms3 = document.getElementsByClassName('box_term3');
                box_terms3[0].textContent = `难度：${kwargs.difficulty[2]}(${kwargs.difficulty[0]})`
                box_terms[0].textContent = `来源：${from}`;
                if (content === null)
                    return;
                box_terms[1].textContent = `码长：${content.code_len.toFixed(6)}`;
                box_terms2[0].textContent = `字数：${content.num_of_char}`;
                box_terms2[1].textContent = `选重：${content.num_of_candidate}`;
                box_terms2[2].textContent = `缺字：${content.num_of_que}`;
                for (let i = 0; i < content.show_list.length; i++) {
                    let node = document.createElement('div');
                    let word = document.createElement('div');
                    let code = document.createElement('div');
                    node.setAttribute('class', 'word_code');
                    word.setAttribute('class', `word_${content.show_list[i].type}`);
                    if (content.show_list[i].is_chong || content.show_list[i].is_que) {
                        let b = document.createElement('b');
                        b.textContent = content.show_list[i].word;
                        word.appendChild(b);
                    }
                    else {
                        word.textContent = content.show_list[i].word;
                    }
                    code.setAttribute('class', `code`);
                    if (content.show_list[i].is_chong || content.show_list[i].is_que) {
                        let b = document.createElement('span');
                        if (content.show_list[i].is_que) {
                            b.setAttribute('class', 'is_que')
                        } else {
                            b.setAttribute('class', 'is_chong')
                        }
                        b.textContent = content.show_list[i].code;
                        code.appendChild(b);
                    }
                    else {
                        code.textContent = content.show_list[i].code;
                    }
                    node.appendChild(word);
                    node.appendChild(code);
                    document.getElementsByClassName('box_word')[0].appendChild(node);
                }
            }, name, from, content, is_first, kwargs);
            await page.waitForNetworkIdle({ idleTime: 50 })
            // bot.logger.warn(await page.content());
            let res = await page.screenshot({ encoding: 'binary', fullPage: true, type: 'jpeg', quality: 50 });
            // await browser.close();
            await browser.close();
            return res;
        } catch (err) {
            console.log(err);
            await browser.close();
            return null;
        }


    }

    let res = []
    let is_first = true
    if (blocks.length > 10) {
        content.show_list = []
        res.push(await run_one_pic(name, from, content, is_first));
        return res;
    }
    for (let block of blocks) {
        content.show_list = block;
        res.push(await run_one_pic(name, from, content, is_first));
        is_first = false
    }
    return res;

}



async function word_hint_get_all_picture(arr, kwargs = {}) {
    // const browser = await puppeteer.launch();
    const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox'] })
    const page = await browser.newPage();
    try {
        await page.setViewport({
            width: 600,
            height: 1,
            deviceScaleFactor: 1.8
        });

        await page.goto(`file://${process.cwd()}/word_hint_getall.html`, { waitUntil: 'domcontentloaded' });
        await page.evaluate((arr, kwargs = {}) => {
            for (let { name, from, content } of arr) {

                // document.body.appendChild(document.createTextNode(`${JSON.stringify({name, from, content})}`))
                let box_all_num = document.getElementsByClassName("box_all_num");
                box_all_num[0].textContent = `总字数：${content.num_of_char}`;
                box_all_num[1].textContent = `难度：${kwargs.difficulty[2]}(${kwargs.difficulty[0]})`;
                let box_head = document.createElement("div")
                box_head.setAttribute("class", "box_head")

                let box_type = document.createElement("div")
                box_type.setAttribute("class", "box_type")

                let box_terms = [document.createElement("div"),
                document.createElement("div"),
                document.createElement("div"),
                document.createElement("div")]
                box_terms[0].setAttribute("class", "box_term")
                box_terms[1].setAttribute("class", "box_term")
                box_terms[2].setAttribute("class", "box_term2")
                box_terms[3].setAttribute("class", "box_term2")
                box_head.appendChild(box_type);
                box_head.appendChild(box_terms[0]);
                box_head.appendChild(box_terms[1]);
                box_head.appendChild(box_terms[2]);
                box_head.appendChild(box_terms[3]);

                box_type.textContent = `【${name}】`
                box_terms[0].textContent = `来源：${from}`;
                box_terms[1].textContent = `码长：${content.code_len.toFixed(6)}`;
                box_terms[2].textContent = `选重：${content.num_of_candidate}`;
                box_terms[3].textContent = `缺字：${content.num_of_que}`;

                document.body.appendChild(box_head)
                if (content.num_of_char > 50) {
                    continue
                }

                let box_word = document.createElement("div")
                box_word.setAttribute("class", "box_word")

                for (let i = 0; i < content.show_list.length; i++) {
                    let node = document.createElement('div');
                    let word = document.createElement('div');
                    let code = document.createElement('div');
                    node.setAttribute('class', 'word_code');
                    word.setAttribute('class', `word_${content.show_list[i].type}`);
                    if (content.show_list[i].is_chong || content.show_list[i].is_que) {
                        let b = document.createElement('b');
                        b.textContent = content.show_list[i].word;
                        word.appendChild(b);
                    }
                    else {
                        word.textContent = content.show_list[i].word;
                    }
                    code.setAttribute('class', `code`);
                    if (content.show_list[i].is_chong || content.show_list[i].is_que) {
                        let b = document.createElement('span');
                        if (content.show_list[i].is_que) {
                            b.setAttribute('class', 'is_que')
                        } else {
                            b.setAttribute('class', 'is_chong')
                        }
                        b.textContent = content.show_list[i].code;
                        code.appendChild(b);
                    }
                    else {
                        code.textContent = content.show_list[i].code;
                    }
                    node.appendChild(word);
                    node.appendChild(code);
                    box_word.appendChild(node);
                }

                document.body.appendChild(box_word)
            }
        }, arr, kwargs)
        await page.waitForNetworkIdle({ idleTime: 50 })
        // bot.logger.info(await page.content())
        let res = await page.screenshot({ encoding: 'binary', fullPage: true, type: 'jpeg', quality: 50 });
        await browser.close();
        return res;
    } catch (err) {
        console.log(err);
        await browser.close();
        return null;
    }

}

async function word_hint_get_raw(name, from, content, kwargs = {}) {
    let arr = [];
    for (let i = 0; i < content.show_list.length; i++) {
        arr.push(content.show_list[i].code)
    }
    return arr.join('');
}

async function word_hint_get_brief(name, from, content, kwargs = {}) {
    let res = ``;
    res += `【${name}】\n`
    res += `来源：${from}\n`;
    res += `字数：${content.num_of_char}\n`;
    res += `难度：${kwargs.difficulty[2]}(${kwargs.difficulty[0]})\n`;
    res += `码长：${content.code_len.toFixed(6)}\n`;
    res += `选重：${content.num_of_candidate}\n`;
    res += `缺字：${content.num_of_que}`;
    return res;
}

async function word_hint_get_brief_all(arr, kwargs = {}) {
    let res = []
    for (let e of arr) {
        res.push(await word_hint_get_brief(e.name, e.from, e.content, kwargs))
    }
    return res;
}




function getRealLength(str) {
    let ret = str.match(/[\s\S]/gu);
    return ret ? ret.length : 0;
}

function mydecode(text) {
    let ans = "";
    for (let i = 0; i < text.length; i++) {
        ans += String.fromCharCode(text.charCodeAt(i) - 1);
    }
    return ans;
}

/**
 * 执行SQL语句
 * @param str SQL语句
 * @returns 查询结果
 */
function run_mysql(str) {
    return new Promise((resolve, reject) => {
        consql.query(str, (err, res) => {
            if (err) {
                reject(err);
                return;
            }
            resolve(res);
        });
    });
}

async function count_word(word) {
    let public_word_base = await run_mysql(`select * from public_word_base`);
    let private_word_base = await run_mysql(`select * from private_word_base`);
    // 合并两个列表的名称
    let name_list = []
    for (let e of public_word_base) {
        name_list.push(e['name'])
    }
    for (let e of private_word_base) {
        name_list.push(e['name'])

    }
    // console.log(name_list)
    let has = 0, valid = 0
    let ans_list = []
    for (let e of name_list) {
        try {
            let res = word_hint.has_word(word, `./word_hint_module/word_hint/${e}`)
            if (res) {
                ans_list.push(e)
                has++;
            }
            valid++;
        } catch (err) {
            console.log(err)
        }
    }
    ans_list.sort()
    return `${word}: ${(has / valid * 100).toFixed(2)}% (${has} / ${valid})\n${ans_list.join(' ')}`
}

async function query_cmd_exist(cmd) {
    let res, from_name;
    res = await run_mysql(`select * from public_word_base where name = ${mysql.escape(cmd)}`);
    if (res.length > 0) {
        from_name = '公共';
    } else {
        res = await run_mysql(`select * from private_word_base where name = ${mysql.escape(cmd)}`);
        if (res.length > 0) {
            from_name = res[0]['qqid'];
        } else {
            return null;
        }
    }
    return from_name;
}

async function query_hint(cmd, from_name, text, solver, displayer, range = { l: 0, r: 100 }) {
    let res = await solver(text, `./word_hint_module/word_hint/${cmd}`, range)
    let ans = await displayer(cmd, from_name, res, { 'difficulty': get_rank(text) })
    return ans
}

async function query_hint_a(text, one_solver, displayer, schemas = null, range = { l: 0, r: 100 }) {
    let res = await solver_all(text, one_solver, schemas, range)
    let ans = await displayer(res, { 'difficulty': get_rank(text) })
    return ans
}

async function get_all_schema() {
    let res1 = await run_mysql('select name from private_word_base;')
    let res2 = await run_mysql('select name from public_word_base;')
    let res = []
    for (let e of res1) {
        res.push(e['name'])
    }
    for (let e of res2) {
        res.push(e['name'])
    }
    return res
}

async function record_info(left, right) {
    let res = await run_mysql(`select * from query_record where query_time >= ${mysql.escape(left)} and query_time <= ${mysql.escape(right)}`);
    // console.log([left, right])
    let ans = {};
    for (let i = 0; i < res.length; i++) {
        let name = res[i]['name'];
        if (ans[name] === undefined) {
            ans[name] = 1;
        } else {
            ans[name]++;
        }
    }
    return ans;
}

// async function insert_record(qqid, name) {
//     let time = process.hrtime.bigint().toString();
//     await run_mysql(`insert into query_record values('${time}', '${qqid}', '${name}')`);
// }
const eps = 1e-6
async function solver_all(text, one_solver, schemas = null, range = { l: 0, r: 100 }) {
    let schema_list
    if (schemas === null) {
        schema_list = fs.readFileSync('./a_list.txt').toString('utf-8').split(/\s+/)
    } else {
        schema_list = schemas
    }
    let ans = []
    for (let e of schema_list) {
        let from_name = await query_cmd_exist(e)
        if (from_name === null) {
            continue
        }
        let res = one_solver(text, `./word_hint_module/word_hint/${e}`, range)
        ans.push({ name: e, from: from_name, content: res })
    }
    ans.sort((a, b) => {
        let tmp = a.content.num_of_que - b.content.num_of_que;
        if (tmp < eps && tmp > -eps) {
            tmp = a.content.code_len - b.content.code_len
            if (tmp < eps && tmp > -eps) {
                tmp = a.content.num_of_candidate - b.content.num_of_candidate
                if (tmp < eps && tmp > -eps) {
                    return a.name.localeCompare(b.name, 'zh')
                }
                return tmp
            }
        }
        return tmp
    })
    return ans
}

function my_split(s) {
    let res = [];
    let tmp = "";
    let state = 0;
    for (let i = 0; i < s.length; i++) {
        tmp += s[i];
        if (state == 0) {
            if (/\s/.test(s[i])) {
                tmp = "";
                state = 0;
            } else if (s[i] == "\"") {
                state = 1;
            } else if (s[i] == "\\") {
                state = 6;
            } else {
                state = 3;
            }
        } else if (state == 1) {
            if (s[i] == "\"") {
                res.push(tmp);
                tmp = "";
                state = 0;
            } else if (s[i] == "\\") {
                state = 4;
            } else {
                state = 1;
            }
        } else if (state == 3) {
            if (/\s/.test(s[i])) {
                tmp = tmp.slice(0, tmp.length - 1)
                tmp += "_";
                state = 3;
            } else if (s[i] == "\"") {
                res.push(tmp.slice(0, tmp.length - 1));
                tmp = s[i];
                state = 1;
            } else if (s[i] == "\\") {
                state = 6;
            } else {
                state = 3;
            }
        } else if (state == 4) {
            state = 1;
        } else if (state == 6) {
            state = 0;
        }
    }
    if (tmp.length > 0) {
        res.push(tmp);
    }
    return res;
}

async function query_ime(e, cmd, txt) {
    // return;
    if (cmd[0] !== '*') {
        return;
    }
    cmd = cmd.slice(1);
    let from_name = await query_cmd_exist(cmd);
    if (from_name === null) {
        return;
    }
    // if (e.message_type === 'group') {
    //     insert_record(e.member.user_id, cmd);
    // } else if (e.message_type === 'private') {
    //     insert_record(e.friend.user_id, cmd)
    // }


    let terms = my_split(txt);

    let res_txt = ""
    // bot.logger.warn(txt)
    // bot.logger.warn(terms)
    for (let i = 0; i < terms.length; i++) {

        if (terms[i][0] != "\"") {
            let res = word_hint.solve_code(terms[i], `./word_hint_module/word_hint/${cmd}`);
            res_txt += res
        } else {
            res_txt += JSON.parse("\"" + terms[i].slice(1, terms[i].length - 1) + "\"")
        }
    }
    if (res_txt.length == 0) {
        bot.send_msg({
            message_type: e.message_type,
            group_id: e.group_id,
            user_id: e.user_id,
            message: [
                Structs.text("大竹打出了一串空气")
            ]
        })
    } else {
        bot.send_msg({
            message_type: e.message_type,
            group_id: e.group_id,
            user_id: e.user_id,
            message: convertCQCodeToJSON(res_txt)
        })
    }
}

async function normal_query_ime(e) {
    let txt = (await get_text_content_from_msg(e.message, false)).join('').trim();
    let pos = txt.search(/\s/);
    // bot.logger.warn(txt)
    if (pos == -1) return;
    let cmd = txt.slice(0, pos);
    txt = txt.slice(pos + 1).trim();
    query_ime(e, cmd, txt)
}

async function reply_query_ime(e) {

    let cmd = "";
    for (let it of e.message) {
        if (it.type === "text") {
            cmd += it.data.text;
            cmd += " ";
        }
    }
    cmd = cmd.trim()
    let id = get_reply(e.message)
    if (typeof id === 'undefined')
        return;
    let res = await bot.get_msg({ message_id: id });

    query_ime(e, cmd, (await get_text_content_from_msg(res.message)).join('').trim())
}

bot.on('message', async e => {
    // console.log(e)
    // if (e.user_id !== 1144107042) return;
    if (has_reply(e.message)) {
        reply_query_ime(e)
    } else {
        normal_query_ime(e)
    }
}
)


function parse_join_text(s) {

}



// 普通查询
bot.on('message', async e => {
    try {
        let txt = (await get_text_content_from_msg(e.message, false)).join('').trim();
        let pos = txt.search(/\s/);

        if (pos == -1) return;


        if (has_reply(e.message)) {
            return;
        }
        let cmd = txt.slice(0, pos);
        txt = txt.slice(pos + 1).trim();

        let is_huang = (cmd[cmd.length - 1] == '黄');
        if (is_huang) {
            cmd = cmd.slice(0, cmd.length - 1)
        }

        let terms;
        let type = 0;
        let is_regular = 0;
        let is_join = 0;
        let isdan = 0;
        if (cmd[0] == '#') {
            type = 1;
            cmd = cmd.slice(1);
            if (cmd[0] == '#') {
                cmd = cmd.slice(1);
                is_regular = 1;
            } else if (cmd[0] == '/') {
                cmd = cmd.slice(1);
                is_join = 1;
            }
        } else if (cmd[0] == '/') {
            type = 2;
            cmd = cmd.slice(1);
            if (cmd[0] == '/') {
                cmd = cmd.slice(1);
                is_regular = 1;
            } else if (cmd[0] == '#') {
                cmd = cmd.slice(1);
                is_join = 1;
            }
        } else if (cmd[0] == '!' || cmd[0] == '！') {
            type = 3;
            cmd = cmd.slice(1);
        } else if (cmd[0] == '&') {
            type = 4;
            cmd = cmd.slice(1);
            //     return;
        } else if (cmd[0] == '^') {
            type = 5;
            cmd = cmd.slice(1);
            if (cmd.length > 1 && (cmd[0] == '!' || cmd[0] == '！')) {
                isdan = 1;
                cmd = cmd.slice(1);
            }
            //   return;
        }


        let page = 0;
        // 是否存在页数
        if (type == 1 || type == 2) {
            let test_page = /^<(\d+)>(.+)$/.exec(cmd);
            // console.log(test_page)
            if (test_page !== null) {
                page = Number(test_page[1])
                cmd = test_page[2]
            }
        }

        let l = page * PAGE_NUM, r = (page + 1) * PAGE_NUM;

        if (type == 0 || type == 3 || type == 4 || type == 5) {
            terms = txt.replaceAll(/(\r\n|\n|\r)+/g, '\n').split('\n')
            // console.log(txt)
            // console.log(terms)
        } else {
            terms = txt.replaceAll(/\s+/g, '\n').split('\n')
        }

        terms = terms.map(e => e.trim())
        terms = terms.filter(e => e.length > 0)
        // if (type == 0) {
        //     let flag = false
        //     for (let i = 1; i < terms.length; i++) {
        //         if (getRealLength(terms[i]) != 1) {
        //             flag = true;
        //             break;
        //         }
        //     }
        //     if (flag) {
        //         terms = [terms[0], terms.slice(1).join(' ')]
        //     }
        // }



        let from_name = await query_cmd_exist(cmd);
        // bot.logger.warn(cmd)
        // console.log(cmd.length)
        // console.log(from_name)
        if (from_name === null && !(cmd === 'a' && (type === 0 || type === 3 || type === 5))) {
            return;
        }
        // if (e.message_type === 'group') {
        //     insert_record(e.member.user_id, cmd);
        // } else if (e.message_type === 'private') {
        //     insert_record(e.friend.user_id, cmd)
        // }

        let pics = [];
        if (is_join) {
            pics.push(Structs.image(await query_hint(cmd, from_name, terms, word_hint_solve_simple_search_regular, word_hint_get_simple_search_picture, { l: l, r: r })));
        } else {
            for (let i = 0; i < Math.min(20, terms.length); i++) {
                if (is_huang) {
                    terms[i] = mydecode(terms[i])
                }
                if (type == 1) {
                    pics.push(Structs.image(await query_hint(cmd, from_name, terms[i], is_regular ? word_hint_solve_simple_regular : word_hint.solve_simple, word_hint_get_simple_picture, { l: l, r: r })));
                } else if (type == 2) {
                    pics.push(Structs.image(await query_hint(cmd, from_name, terms[i], is_regular ? word_hint_solve_search_regular : word_hint.solve_search, word_hint_get_search_picture, { l: l, r: r })));
                } else if (type == 3) {
                    if (cmd === 'a') {
                        pics.push(Structs.image(await query_hint_a(terms[i], word_hint.solve_one, word_hint_get_all_picture)))
                    } else {
                        pics = pics.concat((await query_hint(cmd, from_name, terms[i], word_hint.solve_one, word_hint_get_picture)).map(e => Structs.image(e)))
                        // pics.push(Structs.image(await query_hint(cmd, from_name, terms[i], word_hint.solve_one, word_hint_get_picture)));
                    }
                } else if (type == 0) {
                    if (cmd === 'a') {
                        pics.push(Structs.image(await query_hint_a(terms[i], word_hint.solve, word_hint_get_all_picture)))
                    } else {
                        if (getRealLength(terms[i]) == 1) {
                            pics.push(Structs.image(await query_hint(cmd, from_name, terms[i], word_hint.solve_simple, word_hint_get_simple_picture)));
                        } else {
                            pics = pics.concat((await query_hint(cmd, from_name, terms[i], word_hint.solve, word_hint_get_picture)).map(e => Structs.image(e)))
                            // pics.push(Structs.image(await query_hint(cmd, from_name, terms[i], word_hint.solve, word_hint_get_picture)));
                        }
                    }
                } else if (type == 4) {
                    pics.push(Structs.text(await query_hint(cmd, from_name, terms[i], word_hint.solve, word_hint_get_raw)));
                } else {
                    let func = word_hint.solve;
                    if (isdan) func = word_hint.solve_one;
                    if (cmd === 'a') {
                        // let schemas = await get_all_schema()
                        pics = pics.concat((await query_hint_a(terms[i], func, word_hint_get_brief_all)).map(e => Structs.text(e)))
                    } else {
                        pics.push(Structs.text(await query_hint(cmd, from_name, terms[i], func, word_hint_get_brief)));
                    }
                }
            }
        }

        if (pics.length == 1) {
            bot.send_msg({
                message_type: e.message_type,
                group_id: e.group_id,
                user_id: e.user_id,
                message: pics
            })
        } else {
            let login_info = await bot.get_login_info()
            let msg_list = []
            for (let i = 0; i < pics.length; i++) {
                msg_list.push({
                    type: "node",
                    data: {
                        user_id: login_info.user_id,
                        nickname: login_info.nickname,
                        content: [pics[i]]
                    }
                })
            }

            if (e.message_type == 'group') {
                bot.send_group_forward_msg(
                    {
                        group_id: e.group_id,
                        messages: msg_list,
                    }
                )
            } else {
                bot.send_private_forward_msg(
                    {
                        user_id: e.user_id,
                        messages: msg_list
                    }
                )
            }
        }
    } catch (err) {
        console.log(err)
    }



})


/**
 * 若为标准段落形式，返回去除段号的内容，否则返回本身。
 * @param {String} text
 * @returns
 */
function get_process(text) {
    if (getRealLength(text) == 1) {
        return text
    }
    let arr = text.split(/\n|\r/);
    let len = arr.length;
    let res = []
    for (let i = len - 1; i >= 0;) {
        if (arr[i].startsWith("-----")) {
            if (i > 0) {
                if (i >= 2 && arr[i - 2].slice(0, 2) === '皇叔') {
                    arr[i - 1] = mydecode(arr[i - 1])
                }
                res.push(arr[i - 1])
            }
            i -= 3;
            // if (i == 0)
            //     return ["", false];
            // else if (i >= 2)
            //     return [arr.slice(0,i-2).join("\n") + arr[i-1] + arr.slice(i+1,len).join("\n"), arr[i - 2].slice(0, 2) === '皇叔'];
            // else
            //     return [arr[i-1] + arr.slice(i+1,len).join("\n"), false];
        } else {
            res.push(arr[i])
            i--;
        }
    }
    if (res.length == 0) {
        res.push(arr[0])
    }
    return res.reverse().join(" ");
}

// 回复查询
bot.on('message', async e => {
    try {
        if (!has_reply(e.message)) {
            return;
        }
        let cmds = "";
        for (let it of e.message) {
            if (it.type === "text") {
                cmds += it.data.text;
                cmds += " ";
            }
        }

        cmds = cmds.trim().split(/\s+/)
        if (cmds[0] === "上传词提") {
            return;
        }
        let id = get_reply(e.message)
        if (typeof id === 'undefined')
            return;
        let res = await bot.get_msg({ message_id: id });

        // bot.logger.warn(res)

        let text = (await get_text_content_from_msg(res.message)).map(get_process).join('');
        // let text = tmp_arr[0];
        // let is_huangshu = tmp_arr[1];
        for (let i = 0; i < cmds.length; i++) {
            let cmd = cmds[i];
            let type = 0;

            let is_huang = (cmd[cmd.length - 1] == '黄');
            if (is_huang) {
                cmd = cmd.slice(0, cmd.length - 1)
            }

            if (cmd[0] == '#') {
                type = 1;
                cmd = cmd.slice(1);
                if (cmd[0] == '#') {
                    cmd = cmd.slice(1);
                } else if (cmd[0] == '/') {
                    cmd = cmd.slice(1);
                }
            } else if (cmd[0] == '/') {
                type = 2;
                cmd = cmd.slice(1);
                if (cmd[0] == '/') {
                    cmd = cmd.slice(1);
                } else if (cmd[0] == '#') {
                    cmd = cmd.slice(1);
                }
            } else if (cmd[0] == '!' || cmd[0] == '！') {
                type = 3;
                cmd = cmd.slice(1);
            } else if (cmd[0] == '&') {
                type = 4;
                cmd = cmd.slice(1);
                //     return;
            } else if (cmd[0] == '^') {
                type = 5;
                cmd = cmd.slice(1);
                if (cmd.length > 1 && (cmd[0] == '!' || cmd[0] == '！')) {
                    cmd = cmd.slice(1);
                }
                //   return;
            }

            let from_name = await query_cmd_exist(cmd);
            if (from_name === null && !(cmd === 'a' && (type === 0 || type === 3 || type === 5))) {
                return;
            }
        }
        let pics = [];
        let vis = new Set();
        for (let i = 0; i < cmds.length; i++) {
            if (pics.length >= 20) {
                break;
            }
            let cmd = cmds[i];
            if (vis.has(cmd)) {
                continue;
            }
            vis.add(cmd);
            let is_huang = (cmd[cmd.length - 1] == '黄');
            let now_text = text;
            if (is_huang) {
                cmd = cmd.slice(0, cmd.length - 1)
                now_text = mydecode(now_text)
            }
            // if (is_huangshu && !is_huang) {
            //     now_text = mydecode(now_text)
            // }

            let type = 0;
            let is_regular = 0;
            let is_join = 0;
            let isdan = 0;
            if (cmd[0] == '#') {
                type = 1;
                cmd = cmd.slice(1);
                if (cmd[0] == '#') {
                    cmd = cmd.slice(1);
                    is_regular = 1;
                } else if (cmd[0] == '/') {
                    cmd = cmd.slice(1);
                    is_join = 1;
                }
            } else if (cmd[0] == '/') {
                type = 2;
                cmd = cmd.slice(1);
                if (cmd[0] == '/') {
                    cmd = cmd.slice(1);
                    is_regular = 1;
                } else if (cmd[0] == '#') {
                    cmd = cmd.slice(1);
                    is_join = 1;
                }
            } else if (cmd[0] == '!' || cmd[0] == '！') {
                type = 3;
                cmd = cmd.slice(1);
            } else if (cmd[0] == '&') {
                type = 4;
                cmd = cmd.slice(1);
                //     return;
            } else if (cmd[0] == '^') {
                type = 5;
                cmd = cmd.slice(1);
                if (cmd.length > 1 && (cmd[0] == '!' || cmd[0] == '！')) {
                    isdan = 1;
                    cmd = cmd.slice(1);
                }
                //   return;
            }


            let page = 0;
            // 是否存在页数
            if (type == 1 || type == 2) {
                let test_page = /^<(\d+)>(.+)$/.exec(cmd);
                if (test_page !== null) {
                    page = Number(test_page[1])
                    cmd = test_page[2]
                }
            }

            let l = page * PAGE_NUM, r = (page + 1) * PAGE_NUM;

            let from_name = await query_cmd_exist(cmd);
            if (from_name === null && !(cmd === 'a' && (type === 0 || type === 3 || type === 5))) {
                continue;
            }
            // if (e.message_type === 'group') {
            //     insert_record(e.member.user_id, cmd);
            // } else if (e.message_type === 'private') {
            //     insert_record(e.friend.user_id, cmd)
            // }
            if (is_join) {
                terms = now_text.replaceAll(/\s+/g, '\n').split('\n')
                pics.push(Structs.image(await query_hint(cmd, from_name, terms, word_hint_solve_simple_search_regular, word_hint_get_simple_search_picture, { l: l, r: r })));
            } else {
                if (type == 1) {
                    pics.push(Structs.image(await query_hint(cmd, from_name, now_text, is_regular ? word_hint_solve_simple_regular : word_hint.solve_simple, word_hint_get_simple_picture, { l: l, r: r })));
                } else if (type == 2) {
                    pics.push(Structs.image(await query_hint(cmd, from_name, now_text, is_regular ? word_hint_solve_search_regular : word_hint.solve_search, word_hint_get_search_picture, { l: l, r: r })));
                } else if (type == 3) {
                    if (cmd === 'a') {
                        pics.push(Structs.image(await query_hint_a(now_text, word_hint.solve_one, word_hint_get_all_picture)))
                    } else {
                        pics = pics.concat((await query_hint(cmd, from_name, now_text, word_hint.solve_one, word_hint_get_picture)).map(e => Structs.image(e)))
                        // pics.push(Structs.image(await query_hint(cmd, from_name, now_text, word_hint.solve_one, word_hint_get_picture)));
                    }

                } else if (type == 0) {
                    if (cmd === 'a') {
                        pics.push(Structs.image(await query_hint_a(now_text, word_hint.solve, word_hint_get_all_picture)))
                    } else {
                        if (getRealLength(now_text) == 1) {
                            pics.push(Structs.image(await query_hint(cmd, from_name, now_text, word_hint.solve_simple, word_hint_get_simple_picture)));
                        } else {
                            pics = pics.concat((await query_hint(cmd, from_name, now_text, word_hint.solve, word_hint_get_picture)).map(e => Structs.image(e)))
                            // pics.push(Structs.image(await query_hint(cmd, from_name, now_text, word_hint.solve, word_hint_get_picture)));
                        }
                    }

                } else if (type == 4) {
                    pics.push(Structs.text(await query_hint(cmd, from_name, now_text, word_hint.solve, word_hint_get_raw)));
                } else {
                    let func = word_hint.solve;
                    if (isdan) func = word_hint.solve_one;
                    if (cmd === 'a') {
                        // let schemas = await get_all_schema()
                        // console.log(schemas)
                        pics = pics.concat((await query_hint_a(now_text, func, word_hint_get_brief_all)).map(e => Structs.text(e)))
                    } else {
                        pics.push(Structs.text(await query_hint(cmd, from_name, now_text, func, word_hint_get_brief)));
                    }

                }
            }


        }
        if (pics.length == 0) {
            return;
        }
        if (pics.length == 1) {
            bot.send_msg({
                message_type: e.message_type,
                group_id: e.group_id,
                user_id: e.user_id,
                message: pics
            })
        } else {
            let login_info = await bot.get_login_info()
            let msg_list = []
            for (let i = 0; i < pics.length; i++) {
                msg_list.push({
                    type: "node",
                    data: {
                        user_id: login_info.user_id,
                        nickname: login_info.nickname,
                        content: [pics[i]]
                    }
                })
            }

            if (e.message_type == 'group') {
                bot.send_group_forward_msg(
                    {
                        group_id: e.group_id,
                        messages: msg_list,
                    }
                )
            } else {
                bot.send_private_forward_msg(
                    {
                        user_id: e.user_id,
                        messages: msg_list
                    }
                )
            }
        }

    } catch (err) {
        console.log(err)
    }
})
// let cd_map = new Map();
bot.on("message", async e => {
    let cmd = (await get_text_content_from_msg(e.message, false)).join('').trim()
    let pos = cmd.search(/\s/);
    let reg_txt = '';
    if (pos != -1) {

        reg_txt = cmd.slice(pos + 1);
        cmd = cmd.slice(0, pos);
    }
    if (cmd == '码表列表') {
        try {
            try {
                var reg = RegExp(reg_txt)
            } catch (ee) {
                bot.send_msg({
                    message_type: e.message_type,
                    user_id: e.user_id,
                    group_id: e.group_id,
                    message: String(ee)
                });
            }
            let out = [];
            let res1 = await run_mysql(`select * from private_word_base`);
            let res_list = []
            for (let i = 0; i < res1.length; i++)
                res_list.push([res1[i]['name'], res1[i]['qqid']]);
            let res2 = await run_mysql(`select * from public_word_base`);
            for (let i = 0; i < res2.length; i++)
                res_list.push([res2[i]['name'], '公共']);


            res_list.sort((a, b) => {
                return a[0].localeCompare(b[0], 'zh')
            })

            let login_info = await bot.get_login_info()

            for (let i = 0; i < res_list.length; i++) {

                if (pos != -1) {
                    let tmp = String(res_list[i][0]).match(reg)
                    if (tmp === null || tmp.length == 0) {
                        continue;
                    }
                }
                out.push({
                    type: 'node',
                    data: {
                        user_id: (res_list[i][1] === '公共' ? login_info.user_id : Number(res_list[i][1])),
                        nickname: (res_list[i][1] === '公共' ? String(login_info.user_id) : String(res_list[i][1])),
                        content: Structs.text(`${res_list[i][0]}`)
                    }
                });
            }


            // console.log(out)
            if (out.length > 0) {

                for (let i = 0; i < out.length; i += 100) {
                    const tmp = out.slice(i, i + 100)
                    if (e.message_type == 'group') {
                        await bot.send_group_forward_msg(
                            {
                                group_id: e.group_id,
                                messages: tmp,
                            }
                        )
                    } else {
                        await bot.send_private_forward_msg(
                            {
                                user_id: e.user_id,
                                messages: tmp
                            }
                        )
                    }
                }

            } else {
                bot.send_msg({
                    message_type: e.message_type,
                    user_id: e.user_id,
                    group_id: e.group_id,
                    message: Structs.text("无符合搜索条件的方案")
                });
            }


        }
        catch (e) {
            console.log(e)
        }
    }
});


bot.on("message", async e => {
    // return;
    let cmd = (await get_text_content_from_msg(e.message, false)).join('').trim();
    let cmds = cmd.split(/\s+/);
    if (cmds.length != 1) return;
    cmd = cmds[0];
    if (cmd[0] != "%") {
        return;
    }
    cmd = cmd.slice(1);
    let res = await run_mysql(`select * from public_word_base where name = ${mysql.escape(cmd)}`);
    if (res.length > 0) {
        let ans = word_hint.get_ext(`./word_hint_module/word_hint/${cmd}`);
        bot.send_msg({
            message_type: e.message_type,
            user_id: e.user_id,
            group_id: e.group_id,
            message: Structs.text(`选重键：${ans.candidate}\n最大长度：${ans.maxlen}\n标点引导键：${ans.punct}\n码元：${ans.codeelem}`)
        });
        return;
    }
    res = await run_mysql(`select * from private_word_base where name = ${mysql.escape(cmd)}`);
    if (res.length > 0) {
        let ans = word_hint.get_ext(`./word_hint_module/word_hint/${cmd}`);
        bot.send_msg({
            message_type: e.message_type,
            user_id: e.user_id,
            group_id: e.group_id,
            message: Structs.text(`选重键：${ans.candidate}\n最大长度：${ans.maxlen}\n标点引导键：${ans.punct}\n码元：${ans.codeelem}`)
        });
        return;
    }
});

bot.on("message.private", async e => {
    try {
        let strs = "";
        for (let tmp of e.message) {
            if (tmp.type === 'text') {
                strs += tmp.data.text;
                strs += " ";
            }
        }
        strs = strs.trim().split(/\s+/);
        if (strs[0] === '删除词提') {
            let records = await run_mysql(`select * from private_word_base where qqid = '${mysql.escape(e.sender.user_id)}'`);
            if (records.length > 0) {
                await run_mysql(`delete from private_word_base where qqid = '${mysql.escape(e.sender.user_id)}'`);
                if (fs.existsSync(`./word_hint_module/word_hint/${records[0]['name']}.txt`)) {
                    fs.rmSync(`./word_hint_module/word_hint/${records[0]['name']}.txt`);
                }
                if (fs.existsSync(`./word_hint_module/word_hint/${records[0]['name']}.hint`)) {
                    fs.rmSync(`./word_hint_module/word_hint/${records[0]['name']}.hint`);
                }
                if (fs.existsSync(`./word_hint_module/word_hint/${records[0]['name']}.config`)) {
                    fs.rmSync(`./word_hint_module/word_hint/${records[0]['name']}.config`);
                }
                e.quick_action([Structs.text("删除成功")]);
            }
            else {
                e.quick_action([Structs.text("未找到您上传的词提")]);
            }
            return;
        }
        if (strs[0] === '查看方案配置') {
            let que = await run_mysql(`select * from private_word_base where qqid = '${mysql.escape(e.sender.user_id)}'`);
            if (que.length <= 0) {
                e.quick_action([Structs.text("请先上传词提")]);
                return;
            }
            let config = word_hint.get_ext(`./word_hint_module/word_hint/${que[0]['name']}`);
            e.quick_action([Structs.text(`选重键：${config.candidate}\n最大码长：${config.maxlen}\n标点引导键：${config.punct}`)]);
        }
        if (strs.length < 1)
            return;
        if (strs[0] === '设置选重键') {
            let que = await run_mysql(`select * from private_word_base where qqid = '${mysql.escape(e.sender.user_id)}'`);
            if (que.length <= 0) {
                e.quick_action([Structs.text("请先上传词提")]);
                return;
            }
            let config = word_hint.get_ext(`./word_hint_module/word_hint/${que[0]['name']}`);
            if (strs.length < 2) {
                config.candidate = '_;\'34567890';
            }
            else {
                config.candidate = strs[1];
            }
            word_hint.set_ext(`./word_hint_module/word_hint/${que[0]['name']}`, config);
            e.quick_action([Structs.text('设置完毕')]);
        }
        else if (strs[0] === '设置最大码长') {
            let que = await run_mysql(`select * from private_word_base where qqid = '${mysql.escape(e.sender.user_id)}'`);
            if (que.length <= 0) {
                e.quick_action([Structs.text("请先上传词提")]);
                return;
            }
            let config = word_hint.get_ext(`./word_hint_module/word_hint/${que[0]['name']}`);
            if (strs.length < 2) {
                config.maxlen = 4;
            }
            else {
                config.maxlen = Number(strs[1]);
                if (isNaN(config.maxlen)) {
                    config.maxlen = 4;
                }
            }
            word_hint.set_ext(`./word_hint_module/word_hint/${que[0]['name']}`, config);
            e.quick_action([Structs.text('设置完毕')]);
        }
        else if (strs[0] === '设置标点引导键') {
            let que = await run_mysql(`select * from private_word_base where qqid = '${mysql.escape(e.sender.user_id)}'`);
            if (que.length <= 0) {
                e.quick_action([Structs.text("请先上传词提")]);
                return;
            }
            let config = word_hint.get_ext(`./word_hint_module/word_hint/${que[0]['name']}`);
            if (strs.length < 2) {
                config.punct = '';
            }
            else {
                config.punct = strs[1];
            }
            word_hint.set_ext(`./word_hint_module/word_hint/${que[0]['name']}`, config);
            e.quick_action([Structs.text('设置完毕')]);
        }
        else if (strs[0] === '上传词提') {
            if (!has_reply(e.message)) {
                e.quick_action([Structs.text('没有回复任何消息，请回复一个文件消息。')]);

                return;
            }

            if (strs.length < 2) {
                e.quick_action([Structs.text('请输入方案名称')]);
                return;
            }
            let id = get_reply(e.message)
            // console.log(id)
            if (typeof id === "undefined") {
                e.quick_action([Structs.text('无法找到所回复的消息，请重新上传离线文件。')]);
                return;
            }
            // console.log("测试");
            let msg = await bot.get_msg({ message_id: id });
            // console.log("测试");
            if (msg.message_type !== 'private') {
                e.quick_action([Structs.text('所回复的消息不是私聊消息。')]);
                return;
            }
            if (msg.message.length < 1) {
                e.quick_action([Structs.text('所回复的消息链长度为0')]);
                return;
            }
            if (msg.message[0].type !== 'file') {
                e.quick_action([Structs.text('所回复的消息不是文件消息。')]);
                return;
            }

            let ext = msg.message[0].data.file.slice(msg.message[0].data.file.lastIndexOf('.') + 1);

            if (ext !== 'txt') {
                e.quick_action([Structs.text("此文件非txt格式！")]);
                return;
            }
            if (Number(msg.message[0].data.file_size) > 30 * 1024 * 1024) {
                e.quick_action([Structs.text('文件过大')]);
                return;
            }

            // console.log("上传词提");



            let name = strs[1];
            if (name.length < 2 || name.length > 10) {
                e.quick_action([Structs.text('名字长度需在2字至10字之间')]);
                return;
            }
            // console.log("1111");
            if (name === 'a' || (/[\\\\/:*?\"\'<>|]/g).test(strs[1]) || name === '上传词提' || name === '删除词提' || name === '设置选重键' || name === '设置最大码长' || name === '设置标点引导键' || name === '码表列表' || name === '查看方案配置' || name === 'c' || name === '查询统计') {
                e.quick_action([Structs.text('禁止使用该名字！')]);
                return;
            }
            // console.log("2222");
            let que = await run_mysql(`select * from public_word_base where name = ${mysql.escape(name)}`);

            if (que.length > 0) {
                e.quick_action([Structs.text('该名字已在公共码表中被使用')]);
                return;
            }
            que = await run_mysql(`select * from private_word_base where name = ${mysql.escape(name)} and qqid != '${mysql.escape(e.sender.user_id)}'`);

            if (que.length > 0) {
                e.quick_action([Structs.text('该名字已被别人使用')]);
                return;
            }
            // console.log(e);
            // console.log("--------");
            e.quick_action([Structs.text("上传中...")]);
            const url = await bot.get_private_file_url({ file_id: msg.message[0].data.file_id })
            console.log(url)

            // let file_info = await bot.get_file({ file_id: msg.message[0].data.file_id });
            // console.log(file_info)
            const response = await fetch(url.url)
            await pipeline(
                Readable.fromWeb(response.body),
                fs.createWriteStream(`./word_hint_module/word_hint/${name}.txt`)
            );
            // fs.cpSync(file_info.file, `./word_hint_module/word_hint/${name}.txt`);
            // fs.writeFileSync(`./word_hint_module/word_hint/${name}.txt`, file_info.file, 'base64');

            que = await run_mysql(`select * from private_word_base where qqid = '${mysql.escape(msg.sender.user_id)}'`);

            let config = null;
            // if (que.length > 0) {
            //     if (fs.existsSync(`./word_hint_module/word_hint/${que[0]['name']}.txt`)) {
            //         fs.rmSync(`./word_hint_module/word_hint/${que[0]['name']}.txt`);
            //     }
            //     if (fs.existsSync(`./word_hint_module/word_hint/${que[0]['name']}.hint`)) {
            //         config = word_hint.get_ext(`./word_hint_module/word_hint/${que[0]['name']}`);
            //         fs.rmSync(`./word_hint_module/word_hint/${que[0]['name']}.hint`);
            //     }
            //     if (fs.existsSync(`./word_hint_module/word_hint/${que[0]['name']}.config`)) {
            //         fs.rmSync(`./word_hint_module/word_hint/${que[0]['name']}.config`);
            //     }
            // }

            try {
                if (!word_hint.save_table(`./word_hint_module/word_hint/${name}`)) {
                    e.quick_action([Structs.text("上传失败，可能原因：词提格式不正确")]);
                }
                else {
                    if (config !== null) {
                        word_hint.set_ext(`./word_hint_module/word_hint/${name}`, config);
                    }
                    if (que.length > 0) {
                        await run_mysql(`update private_word_base set name = ${mysql.escape(name)} where qqid = '${mysql.escape(e.sender.user_id)}'`);
                    }
                    else {
                        await run_mysql(`insert into private_word_base values('${mysql.escape(e.sender.user_id)}', ${mysql.escape(name)})`);
                    }
                    e.quick_action([Structs.text('上传完毕')]);
                }
            }
            catch (err) {
                console.log(err)
                e.quick_action([Structs.text("上传失败，可能原因：词提格式不正确")]);
            }

        }
    }
    catch (e) {
        console.log(e);
    }
})


// function calc_start_time(now, len) {
//     let tmp = 1n;
//     while (!Number.isInteger(len)) {
//         tmp = tmp * 10n;
//         len = len * 10;
//     }
//     let res = now - BigInt(len) * BigInt(86400000000000) / BigInt(tmp);
//     return res;
// }



// let cd_map = new Map();

// bot.on("message", async e => {
//     let cmd = e.raw_message.trim();

//     let cmds = cmd.split(/\s+/);
//     if (cmds[0] === '查询统计') {

//         if (cd_map.has(e.user_id)) {
//             let cd_timeout = process.hrtime.bigint() - cd_map.get(e.user_id)
//             if (cd_timeout < 60000000000n) {
//                 cd_timeout = 60 - Number(cd_timeout / 1000000000n);
//                 e.reply(`${cd_timeout}秒后才能再次查询码表列表或查询统计`);
//                 return;
//             }
//         }
//         cd_map.set(e.user_id, process.hrtime.bigint());

//         let len = 1;
//         if (cmds.length > 1 && !isNaN(+cmds[1])) {
//             len = (+cmds[1]);
//         }
//         console.log(len)
//         if (len < 0) {
//             return;
//         }
//         let now = process.hrtime.bigint();
//         let res = await record_info(calc_start_time(now, len), now);
//         let ans = [];
//         Object.entries(res).forEach(([key, value]) => {
//             ans.push([key, value]);
//         });
//         console.log(res)
//         if (ans.length < 1) {
//             return;
//         }
//         ans.sort((a, b) => {
//             return b[1] - a[1];
//         });
//         console.log(ans)
//         let out = [];
//         let login_info = await bot.get_login_info()
//         out.push({ type: "node", data: { user_id: login_info.user_id, message: Structs.text(`${len}天查询统计`) } });
//         for (let i = 0; i < ans.length; i++) {
//             out.push({ type: "node", data: { user_id: login_info.user_id, message: Structs.text(`${ans[i][0]}\n${ans[i][1]} 次`) } });
//         }

//         if (e.message_type == 'group') {
//             bot.send_group_forward_msg(
//                 {
//                     group_id: e.group_id,
//                     messages: out,
//                     news: [],
//                     prompt: "",
//                     summary: "",
//                     source: ""
//                 }
//             )
//         } else {
//             bot.send_private_forward_msg(
//                 {
//                     user_id: e.user_id,
//                     messages: out
//                 }
//             )
//         }
//     }
// })


// 查询当前所有方案含词率

bot.on('message', async e => {
    const CMD = 'd'
    try {

        let terms = [];
        if (has_reply(e.message)) {
            // 回复查询
            let cmds = "";
            for (let it of e.message) {
                if (it.type === "text") {
                    cmds += it.data.text;
                    cmds += " ";
                }
            }
            cmds = cmds.trim()
            if (cmds !== CMD) return;
            let id = get_reply(e.message)
            if (typeof id === 'undefined')
                return;
            let res = await bot.get_msg({ message_id: id });

            // bot.logger.warn(res)

            let text = (await get_text_content_from_msg(res.message)).join('');
            terms = [text]
        } else {
            // 普通查询
            let txt = (await get_text_content_from_msg(e.message, false)).join('').trim();
            let pos = txt.search(/\s/);
            if (pos == -1) return;

            let cmd = txt.slice(0, pos);
            txt = txt.slice(pos + 1).trim();
            if (cmd !== CMD) return;
            terms = txt.replaceAll(/\s+/g, '\n').split('\n')

        }
        let ans = []
        for (let i = 0; i < Math.min(20, terms.length); i++) {
            ans.push(await count_word(terms[i]))
        }
        e.quick_action(Structs.text(ans.join('\n\n')))

    } catch (e) {
        console.log(e)
    }
})

