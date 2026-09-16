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
import { configureRegularWorkers, removeRegularWorkerScheme, replaceRegularWorkerScheme, runRegularWithTimeout } from "./syncWithTimeout.js";
import { Readable } from 'node:stream';
import { pipeline } from 'stream/promises';
import path from 'node:path';
import { beginLatestUserUpload, buildHintAsync, cancelLatestUserUpload, cancelUploadsForSchemes, finishLatestUserUpload, throwIfUploadSuperseded, withSchemeMutations, withUserMutation, withUserMutations } from './hintBuildManager.js';
import { createLinkedSchemeVersion, createSchemeVersion, linkOrCopy, publishSchemeVersion, removeDirectory, removeSchemeStorage, schemePath } from './hintSchemeStorage.js';
import { AdminCommandError, AdminDeleteConfirmationStore, assertAdminUploadTarget, assertOwnershipChange, assertSchemeRename, extractDirectAdminCommandText, isWordHintAdmin, normalizeAdminConfigValue, parseWordHintAdminCommand, validateSchemeName, WORD_HINT_ADMIN_HELP } from './wordHintAdmin.js';
import { assertUserUploadCapacity, resolveOwnedScheme, resolveUserConfigSelection } from './wordHintUser.js';
import { databaseConfig } from './config.js';
import { runMysqlTransaction } from './mysqlTransaction.js';
import { buildWordHintHeatmap } from './wordHintHeatmap.js';
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
const MAX_WORD_HINT_UPLOAD_BYTES = 512 * 1024 * 1024
const adminDeleteConfirmations = new AdminDeleteConfirmationStore()
function formatFileSize(bytes) {
    if (!Number.isFinite(bytes) || bytes < 0) return '未知';
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KiB`;
    return `${(bytes / 1024 / 1024).toFixed(1)} MiB`;
}
async function sendQuotedText(e, text, label = '消息') {
    try {
        return await bot.send_msg({
            message_type: e.message_type,
            user_id: e.user_id,
            group_id: e.group_id,
            message: [Structs.reply(e.message_id), Structs.text(text)]
        });
    } catch (err) {
        console.warn(`${label}发送失败:`, err.message || err);
        return null;
    }
}
async function word_hint_solve_simple_regular(reg_txt, schema, range = { l: 0, r: 100 }) {
    try {
        let res = await runRegularWithTimeout('simple', [reg_txt, schema, range], 15000)
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

        let res = await runRegularWithTimeout('simple_search', [reg_txt_simple, reg_txt_search, reg_txt_chong, schema, range], 15000)
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
        let res = await runRegularWithTimeout('search', [reg_txt, schema, range], 15000)
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
    const heatmap = buildWordHintHeatmap(content?.show_list);
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
            await page.evaluate((name, from, content, is_first, kwargs, heatmap) => {
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
                if (is_first) {
                    const container = document.getElementById('word_hint_heatmap');
                    for (const row of heatmap.rows) {
                        const rowNode = document.createElement('div');
                        rowNode.className = 'heatmap_row';
                        for (const key of row) {
                            const keyNode = document.createElement('div');
                            const labelNode = document.createElement('span');
                            const countNode = document.createElement('span');
                            const count = heatmap.counts[key.key] || 0;
                            const style = heatmap.styles[key.key];
                            keyNode.className = 'heatmap_key';
                            labelNode.className = 'heatmap_key_label';
                            countNode.className = 'heatmap_key_count';
                            keyNode.style.flex = `${key.width || 1} 1 0`;
                            keyNode.style.backgroundColor = style.backgroundColor;
                            keyNode.style.color = style.color;
                            labelNode.textContent = key.label;
                            if (count) countNode.textContent = count;
                            keyNode.title = `${key.title || key.label}: ${count} 次`;
                            keyNode.appendChild(labelNode);
                            keyNode.appendChild(countNode);
                            rowNode.appendChild(keyNode);
                        }
                        container.appendChild(rowNode);
                    }
                }
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
            }, name, from, content, is_first, kwargs, heatmap);
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

async function preloadRegisteredSchemes() {
    try {
        const [publicRows, privateRows] = await Promise.all([
            run_mysql('select name from public_word_base'), run_mysql('select name from private_word_base')
        ]);
        const paths = [...new Set([...publicRows, ...privateRows].map(row => schemePath(row.name)))];
        const result = word_hint.preload(paths);
        for (const failed of result.failed) console.warn(`词提预热失败（将按需重试）: ${failed.path}: ${failed.error}`);
        await configureRegularWorkers(paths);
    } catch (err) {
        // A database outage or one bad .hint must never prevent bot startup.
        console.warn('词提预热跳过（后续查询将按需加载）:', err.message || err);
    }
}
void preloadRegisteredSchemes();

async function refreshPublishedScheme(name, oldBase) {
    const base = schemePath(name);
    if (!word_hint.replace(base)) throw new Error('cannot mmap published hint');
    await replaceRegularWorkerScheme(base);
    if (oldBase !== base) {
        word_hint.remove(oldBase);
        await removeRegularWorkerScheme(oldBase);
    }
    return base;
}

async function restorePublishedScheme(name, publication) {
    publication.rollback();
    const restoredBase = schemePath(name);
    if (fs.existsSync(`${restoredBase}.hint`)) {
        word_hint.replace(restoredBase);
        await replaceRegularWorkerScheme(restoredBase);
    } else {
        word_hint.remove(publication.newBase);
        await removeRegularWorkerScheme(publication.newBase);
    }
    if (publication.oldBase !== publication.newBase && fs.existsSync(`${publication.oldBase}.hint`)) {
        word_hint.replace(publication.oldBase);
        await replaceRegularWorkerScheme(publication.oldBase);
    }
}

async function updateSchemeConfigAtomically(name, mutate) {
    const sourceBase = schemePath(name);
    const version = createSchemeVersion(name);
    let committed = false;
    try {
        linkOrCopy(`${sourceBase}.txt`, `${version.base}.txt`);
        linkOrCopy(`${sourceBase}.hint`, `${version.base}.hint`);
        fs.copyFileSync(`${sourceBase}.config`, `${version.base}.config`);
        const config = word_hint.get_ext(version.base);
        mutate(config);
        if (!word_hint.set_ext(version.base, config)) throw new Error('cannot write staged config');
        word_hint.get_ext(version.base);

        const publication = publishSchemeVersion(name, version.directory);
        try {
            await refreshPublishedScheme(name, publication.oldBase);
        } catch (err) {
            await restorePublishedScheme(name, publication);
            throw err;
        }
        committed = true;
        try {
            publication.cleanupPrevious();
        } catch (cleanupError) {
            console.warn('旧词提配置版本清理失败:', cleanupError.message || cleanupError);
        }
    } finally {
        if (!committed) removeDirectory(version.directory);
    }
}

async function findRegisteredScheme(name) {
    const [publicRows, privateRows] = await Promise.all([
        run_mysql(`select * from public_word_base where name = ${mysql.escape(name)}`),
        run_mysql(`select * from private_word_base where name = ${mysql.escape(name)}`)
    ]);
    if (publicRows.length + privateRows.length === 0) return null;
    if (publicRows.length + privateRows.length !== 1) {
        const err = new Error(`ambiguous scheme registration: ${name}`);
        err.userMessage = '数据库中存在重复的同名登记，已拒绝操作，请先人工检查数据。';
        throw err;
    }
    return publicRows.length === 1
        ? { name, kind: 'public', qqid: null }
        : { name, kind: 'private', qqid: String(privateRows[0].qqid) };
}

function sameRegisteredScheme(left, right) {
    return left !== null && right !== null
        && left.name === right.name && left.kind === right.kind && left.qqid === right.qqid;
}

async function getOwnedPrivateSchemes(qqid) {
    return run_mysql(`select name from private_word_base where qqid = ${mysql.escape(String(qqid))} order by name`);
}

async function getRepliedWordHintFile(e) {
    if (!has_reply(e.message)) throw new AdminCommandError('请先发送一个离线 .txt 文件，再引用该文件发送上传命令。');
    const replyId = get_reply(e.message);
    if (typeof replyId === 'undefined') throw new AdminCommandError('无法找到所引用的消息，请重新发送离线文件后再试。');
    let msg;
    try {
        msg = await bot.get_msg({ message_id: replyId });
    } catch (_) {
        throw new AdminCommandError('读取所引用的文件消息失败，请重新发送离线文件后再试。');
    }
    if (msg.message_type !== 'private') throw new AdminCommandError('引用的文件必须来自与机器人的私聊。');
    const file = msg.message?.find(item => item.type === 'file');
    if (!file) throw new AdminCommandError('引用的消息不是文件消息。');
    const filename = String(file.data.file || '');
    if (filename.slice(filename.lastIndexOf('.') + 1).toLowerCase() !== 'txt') {
        throw new AdminCommandError('仅支持扩展名为 .txt 的码表文件。');
    }
    const size = Number(file.data.file_size);
    if (!Number.isFinite(size) || size < 0) throw new AdminCommandError('无法读取文件大小，请重新发送离线文件后再试。');
    if (size > MAX_WORD_HINT_UPLOAD_BYTES) {
        throw new AdminCommandError(`文件大小为 ${formatFileSize(size)}，最大支持 512 MiB。`);
    }
    return { fileId: file.data.file_id, filename, size };
}

async function downloadAdminUploadVersion(command, file, version, task, replyUpload) {
    task.phase = '下载文件';
    const url = await bot.get_private_file_url({ file_id: file.fileId });
    throwIfUploadSuperseded(task);
    const response = await fetch(url.url, { signal: task.controller.signal });
    if (!response.ok || !response.body) throw new Error(`download failed (${response.status})`);
    await pipeline(Readable.fromWeb(response.body), fs.createWriteStream(`${version.base}.txt`), { signal: task.controller.signal });
    throwIfUploadSuperseded(task);
    task.phase = '等待操作锁';
    await replyUpload(`管理员上传中...（2/4：等待处理）\n方案：${command.name}\n文件已下载，正在等待相关用户及方案操作锁。`);
}

async function buildAndValidateAdminHint(command, version, task, replyUpload, inheritedConfig) {
    task.phase = '等待构建队列';
    await buildHintAsync(path.resolve(version.base), {
        signal: task.controller.signal,
        onStart: () => {
            task.phase = '构建 Hint';
            return replyUpload(`管理员上传中...（3/4：构建 Hint）\n方案：${command.name}\n已取得全局构建槽位。`);
        }
    });
    throwIfUploadSuperseded(task);
    task.phase = '校验并发布';
    await replyUpload(`管理员上传中...（4/4：校验并发布）\n方案：${command.name}\n正在校验并原子切换方案版本。`);
    if (inheritedConfig !== null && !word_hint.set_ext(version.base, inheritedConfig)) {
        throw new Error('cannot preserve scheme config');
    }
    word_hint.get_ext(version.base);
    if (!word_hint.replace(version.base)) throw new Error('cannot mmap staged hint');
    word_hint.remove(version.base);
    return fs.statSync(`${version.base}.hint`).size;
}

async function publishAdminUpload(command, version, task, replyUpload) {
    let result;
    const publish = async ({ oldName, inheritedConfig, register }) => {
        const hintSize = await buildAndValidateAdminHint(command, version, task, replyUpload, inheritedConfig);
        throwIfUploadSuperseded(task);
        const publication = publishSchemeVersion(command.name, version.directory);
        try {
            await refreshPublishedScheme(command.name, publication.oldBase);
            throwIfUploadSuperseded(task);
            task.phase = '登记方案';
            task.cancelable = false;
            await register();
        } catch (err) {
            await restorePublishedScheme(command.name, publication);
            throw err;
        }
        result = { hintSize, oldName, publication };
    };

    if (command.kind === 'public') {
        await withSchemeMutations([command.name], async () => {
            const existing = await findRegisteredScheme(command.name);
            assertAdminUploadTarget(command, existing);
            const inheritedConfig = command.replace ? word_hint.get_ext(schemePath(command.name)) : null;
            await publish({
                oldName: command.replace ? command.name : null,
                inheritedConfig,
                register: () => command.replace
                    ? Promise.resolve()
                    : run_mysql(`insert into public_word_base (name) values (${mysql.escape(command.name)})`)
            });
        });
    } else {
        await withUserMutation(command.qqid, async () => {
            await withSchemeMutations([command.name], async () => {
                const named = await findRegisteredScheme(command.name);
                assertAdminUploadTarget(command, named);
                const inheritedConfig = command.replace ? word_hint.get_ext(schemePath(command.name)) : null;
                await publish({
                    oldName: command.replace ? command.name : null,
                    inheritedConfig,
                    register: () => command.replace
                        ? Promise.resolve()
                        : run_mysql(`insert into private_word_base (qqid, name) values (${mysql.escape(command.qqid)}, ${mysql.escape(command.name)})`)
                });
            });
        });
    }
    return result;
}

async function runAdminUpload(e, command) {
    validateSchemeName(command.name);
    const file = await getRepliedWordHintFile(e);
    const replyUpload = text => sendQuotedText(e, text, '管理员词提上传状态消息');
    const task = beginLatestUserUpload(`admin:${e.sender.user_id}`, command.name);
    const startedAt = Date.now();
    let version = null;
    let committed = false;
    try {
        await replyUpload(`管理员上传中...（1/4：下载文件）\n目标：${command.kind === 'public' ? '公共' : `私人 QQ ${command.qqid}`}\n方案：${command.name}\n模式：${command.replace ? '显式替换' : '新建'}\n文件：${file.filename}（${formatFileSize(file.size)}）`);
        version = createSchemeVersion(command.name);
        await downloadAdminUploadVersion(command, file, version, task, replyUpload);
        const result = await publishAdminUpload(command, version, task, replyUpload);
        committed = true;
        task.phase = '清理旧版本';
        try {
            result.publication.cleanupPrevious();
            if (result.oldName !== null && result.oldName !== command.name) {
                const oldBase = schemePath(result.oldName);
                word_hint.remove(oldBase);
                await removeRegularWorkerScheme(oldBase);
                removeSchemeStorage(result.oldName);
            }
        } catch (cleanupError) {
            console.warn('管理员上传后的旧版本清理失败:', cleanupError.message || cleanupError);
        }
        await replyUpload(`管理员上传完成\n方案：${command.name}\n类型：${command.kind === 'public' ? '公共' : `私人（QQ ${command.qqid}）`}\n操作：${command.replace ? '替换' : '新建'}\nHint：${formatFileSize(result.hintSize)}\n用时：${((Date.now() - startedAt) / 1000).toFixed(1)} 秒\n新方案已经可以查询。`);
    } catch (err) {
        if (task.controller.signal.aborted) {
            await replyUpload(`管理员上传已取消\n方案：${command.name}\n取消时阶段：${task.phase}\n临时文件已清理，原方案未被覆盖。`);
        } else {
            await replyUpload(`管理员上传失败\n方案：${command.name}\n失败阶段：${task.phase}\n原因：${err.userMessage || err.message || '未知错误'}\n临时文件将被清理，原方案和登记保持不变。`);
        }
    } finally {
        if (!committed && version !== null) removeDirectory(version.directory);
        finishLatestUserUpload(task);
    }
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
            let res = word_hint.has_word(word, schemePath(e))
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
    let res = await solver(text, schemePath(cmd), range)
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
        let res = one_solver(text, schemePath(e), range)
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
            let res = word_hint.solve_code(terms[i], schemePath(cmd));
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
    try {
        const text = (await get_text_content_from_msg(e.message, false)).join('').trim();
        const parts = text.split(/\s+/).filter(Boolean);
        if (parts[0] !== '查询码表') return;
        if (parts.length > 2) {
            await sendQuotedText(e, '正确格式：查询码表 [QQ号|公共]', '查询码表回复');
            return;
        }
        const target = parts[1] || String(e.sender.user_id);
        let rows;
        let owner;
        if (target === '公共') {
            rows = await run_mysql('select name from public_word_base order by name');
            owner = '公共';
        } else {
            if (!/^\d{5,12}$/.test(target)) {
                await sendQuotedText(e, '查询对象必须是完整 QQ 号或“公共”。\n正确格式：查询码表 [QQ号|公共]', '查询码表回复');
                return;
            }
            rows = await getOwnedPrivateSchemes(target);
            owner = target;
        }
        if (rows.length === 0) {
            await sendQuotedText(e, owner === '公共' ? '当前没有公共码表。' : `QQ ${owner} 没有私人码表。`, '查询码表回复');
            return;
        }
        const loginInfo = await bot.get_login_info();
        const nodes = rows.map(row => ({
            type: 'node',
            data: {
                user_id: owner === '公共' ? loginInfo.user_id : Number(owner),
                nickname: owner === '公共' ? String(loginInfo.user_id) : String(owner),
                content: Structs.text(String(row.name))
            }
        }));
        for (let i = 0; i < nodes.length; i += 100) {
            const messages = nodes.slice(i, i + 100);
            if (e.message_type === 'group') {
                await bot.send_group_forward_msg({ group_id: e.group_id, messages });
            } else {
                await bot.send_private_forward_msg({ user_id: e.user_id, messages });
            }
        }
    } catch (err) {
        console.warn('查询码表失败:', err.message || err);
        await sendQuotedText(e, '查询码表失败，请稍后重试。', '查询码表回复');
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
        let ans = word_hint.get_ext(schemePath(cmd));
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
        let ans = word_hint.get_ext(schemePath(cmd));
        bot.send_msg({
            message_type: e.message_type,
            user_id: e.user_id,
            group_id: e.group_id,
            message: Structs.text(`选重键：${ans.candidate}\n最大长度：${ans.maxlen}\n标点引导键：${ans.punct}\n码元：${ans.codeelem}`)
        });
        return;
    }
});

async function listAdminSchemes(e, command) {
    const [publicRows, privateRows] = await Promise.all([
        run_mysql('select name from public_word_base'),
        run_mysql('select qqid, name from private_word_base')
    ]);
    let rows = [];
    if (command.kind !== '私人') rows.push(...publicRows.map(row => ({ name: row.name, label: '公共' })));
    if (command.kind !== '公共') rows.push(...privateRows.map(row => ({ name: row.name, label: `私人 QQ ${row.qqid}` })));
    if (command.keyword) rows = rows.filter(row => String(row.name).includes(command.keyword));
    rows.sort((a, b) => String(a.name).localeCompare(String(b.name), 'zh'));
    if (rows.length === 0) {
        await sendQuotedText(e, '没有符合条件的码表。', '管理员码表列表');
        return;
    }
    for (let i = 0; i < rows.length; i += 80) {
        const body = rows.slice(i, i + 80).map(row => `[${row.label}] ${row.name}`).join('\n');
        await sendQuotedText(e, `管理员码表列表（${i + 1}-${Math.min(i + 80, rows.length)} / ${rows.length}）\n${body}`, '管理员码表列表');
    }
}

async function showAdminScheme(e, name) {
    const registered = await findRegisteredScheme(name);
    if (registered === null) throw new AdminCommandError('未找到该方案。');
    const base = schemePath(name);
    const fileLines = [];
    for (const ext of ['.txt', '.hint', '.config']) {
        try {
            fileLines.push(`${ext.slice(1).toUpperCase()}：${formatFileSize(fs.statSync(base + ext).size)}`);
        } catch (_) {
            fileLines.push(`${ext.slice(1).toUpperCase()}：缺失`);
        }
    }
    let configText;
    try {
        const config = word_hint.get_ext(base);
        configText = `选重键：${config.candidate}\n最大码长：${config.maxlen}\n标点引导键：${config.punct || '无'}\n码元：${config.codeelem}`;
    } catch (err) {
        configText = `配置读取失败：${err.message || err}`;
    }
    await sendQuotedText(
        e,
        `方案：${name}\n类型：${registered.kind === 'public' ? '公共' : '私人'}${registered.qqid === null ? '' : `\n所属 QQ：${registered.qqid}`}\n${fileLines.join('\n')}\n${configText}`,
        '管理员查看码表'
    );
}

async function lookupAdminPrivateSchemeByQq(e, qqid) {
    const rows = await run_mysql(`select name from private_word_base where qqid = ${mysql.escape(qqid)} order by name`);
    if (rows.length === 0) {
        await sendQuotedText(e, `QQ：${qqid}\n未登记私人方案。`, '管理员按 QQ 查询码表');
        return;
    }
    await sendQuotedText(e, `QQ：${qqid}\n私人方案（${rows.length}）：\n${rows.map(row => row.name).join('\n')}`, '管理员按 QQ 查询码表');
}

async function setAdminSchemeConfig(command) {
    const expected = await findRegisteredScheme(command.name);
    if (expected === null) throw new AdminCommandError('未找到该方案。');
    const value = normalizeAdminConfigValue(command.field, command.value);
    const operation = async () => withSchemeMutations([command.name], async () => {
        const current = await findRegisteredScheme(command.name);
        if (!sameRegisteredScheme(expected, current)) throw new AdminCommandError('方案登记在等待操作期间发生变化，请重试。');
        await updateSchemeConfigAtomically(command.name, config => {
            if (command.field === '选重键') config.candidate = value;
            else if (command.field === '最大码长') config.maxlen = value;
            else config.punct = value;
        });
    });
    if (expected.kind === 'private') await withUserMutation(expected.qqid, operation);
    else await operation();
}

function formatSchemeOwner(scheme) {
    return scheme.kind === 'public' ? '公共' : `私人（QQ ${scheme.qqid}）`;
}

async function changeAdminSchemeOwnership(command) {
    const expected = await findRegisteredScheme(command.name);
    assertOwnershipChange(expected, command.target);
    const qqids = [expected.qqid, command.target.qqid].filter(qqid => qqid !== null);
    return withUserMutations(qqids, async () => withSchemeMutations([command.name], async () => {
        const current = await findRegisteredScheme(command.name);
        if (!sameRegisteredScheme(expected, current)) {
            throw new AdminCommandError('方案归属在等待操作期间发生变化，请重试。');
        }
        assertOwnershipChange(current, command.target);
        try {
            await runMysqlTransaction(
                () => mysql.createConnection(databaseConfig),
                async query => {
                    if (current.kind === 'private' && command.target.kind === 'private') {
                        const result = await query(
                            'update private_word_base set qqid = ? where qqid = ? and name = ?',
                            [command.target.qqid, current.qqid, command.name]
                        );
                        if (result.affectedRows !== 1) throw new Error('private owner update affected an unexpected number of rows');
                        return;
                    }
                    if (current.kind === 'private') {
                        const deleted = await query(
                            'delete from private_word_base where qqid = ? and name = ?',
                            [current.qqid, command.name]
                        );
                        if (deleted.affectedRows !== 1) throw new Error('private ownership removal affected an unexpected number of rows');
                        await query('insert into public_word_base (name) values (?)', [command.name]);
                        return;
                    }
                    const deleted = await query('delete from public_word_base where name = ?', [command.name]);
                    if (deleted.affectedRows !== 1) throw new Error('public ownership removal affected an unexpected number of rows');
                    await query(
                        'insert into private_word_base (qqid, name) values (?, ?)',
                        [command.target.qqid, command.name]
                    );
                }
            );
        } catch (err) {
            console.warn('管理员调整方案归属事务失败:', err.message || err);
            const transactionError = new AdminCommandError('数据库事务失败，方案归属保持不变。');
            transactionError.cause = err;
            throw transactionError;
        }
        return { before: current, after: { name: command.name, ...command.target } };
    }));
}

function getRepresentativeSchemeNames() {
    return fs.readFileSync('./a_list.txt', 'utf8').split(/\s+/).filter(Boolean);
}

async function renameAdminScheme(command) {
    const [expected, initialTarget] = await Promise.all([
        findRegisteredScheme(command.oldName),
        findRegisteredScheme(command.newName)
    ]);
    assertSchemeRename(command, expected, initialTarget);
    const qqids = expected.kind === 'private' ? [expected.qqid] : [];
    return withUserMutations(qqids, async () => withSchemeMutations([command.oldName, command.newName], async () => {
        const [current, target] = await Promise.all([
            findRegisteredScheme(command.oldName),
            findRegisteredScheme(command.newName)
        ]);
        if (!sameRegisteredScheme(expected, current)) {
            throw new AdminCommandError('原方案登记在等待操作期间发生变化，请重试。');
        }
        assertSchemeRename(command, current, target, getRepresentativeSchemeNames());

        const cancelledUploads = cancelUploadsForSchemes(
            [command.oldName, command.newName],
            { oldName: command.oldName, newName: command.newName }
        );
        if (cancelledUploads.committing > 0) {
            throw new AdminCommandError('相关方案仍有上传正在最终登记，请稍后重试。');
        }

        const sourceBase = schemePath(command.oldName);
        let version = null;
        let publication = null;
        let committed = false;
        let rollbackSafe = true;
        try {
            version = createLinkedSchemeVersion(sourceBase, command.newName);
            word_hint.get_ext(version.base);
            if (!word_hint.replace(version.base)) throw new Error('cannot mmap renamed scheme');
            word_hint.remove(version.base);

            publication = publishSchemeVersion(command.newName, version.directory);
            try {
                await refreshPublishedScheme(command.newName, publication.oldBase);
                const result = current.kind === 'public'
                    ? await run_mysql(`update public_word_base set name = ${mysql.escape(command.newName)} where name = ${mysql.escape(command.oldName)}`)
                    : await run_mysql(`update private_word_base set name = ${mysql.escape(command.newName)} where qqid = ${mysql.escape(current.qqid)} and name = ${mysql.escape(command.oldName)}`);
                if (result.affectedRows !== 1) throw new Error('scheme rename affected an unexpected number of rows');
            } catch (err) {
                try {
                    await restorePublishedScheme(command.newName, publication);
                } catch (restoreError) {
                    rollbackSafe = false;
                    console.warn('管理员重命名方案回滚新路径失败:', restoreError.message || restoreError);
                }
                throw err;
            }

            committed = true;
            const cleanupSteps = [
                async () => publication.cleanupPrevious(),
                async () => word_hint.remove(sourceBase),
                async () => removeRegularWorkerScheme(sourceBase),
                async () => removeSchemeStorage(command.oldName)
            ];
            for (const cleanup of cleanupSteps) {
                try {
                    await cleanup();
                } catch (cleanupError) {
                    console.warn('管理员重命名方案后的旧路径清理失败:', cleanupError.message || cleanupError);
                }
            }
            return { scheme: current, cancelledUploads: cancelledUploads.cancelled };
        } catch (err) {
            console.warn('管理员重命名方案失败:', err.message || err);
            const renameError = new AdminCommandError(
                rollbackSafe
                    ? '方案重命名失败，原名称和登记保持不变。'
                    : '方案重命名失败且新路径回滚异常，请检查日志后再操作。'
            );
            renameError.cause = err;
            throw renameError;
        } finally {
            if (!committed && rollbackSafe && version !== null) removeDirectory(version.directory);
        }
    }));
}

async function deleteRegisteredScheme(expected) {
    let cleanupError = null;
    const operation = async () => withSchemeMutations([expected.name], async () => {
        const current = await findRegisteredScheme(expected.name);
        if (!sameRegisteredScheme(expected, current)) throw new AdminCommandError('方案登记已发生变化，确认码失效，请重新发起删除。');
        if (expected.kind === 'public') {
            await run_mysql(`delete from public_word_base where name = ${mysql.escape(expected.name)}`);
        } else {
            await run_mysql(`delete from private_word_base where qqid = ${mysql.escape(expected.qqid)} and name = ${mysql.escape(expected.name)}`);
        }
        const base = schemePath(expected.name);
        try {
            word_hint.remove(base);
            await removeRegularWorkerScheme(base);
            removeSchemeStorage(expected.name);
        } catch (err) {
            cleanupError = err;
            console.warn('管理员删除词提后的文件清理失败:', err.message || err);
        }
    });
    if (expected.kind === 'private') await withUserMutation(expected.qqid, operation);
    else await operation();
    return cleanupError;
}

async function handleAdminDeleteRequest(e, name) {
    const registered = await findRegisteredScheme(name);
    if (registered === null) throw new AdminCommandError('未找到该方案。');
    const token = adminDeleteConfirmations.create(e.sender.user_id, registered);
    await sendQuotedText(
        e,
        `删除尚未执行\n方案：${registered.name}\n类型：${registered.kind === 'public' ? '公共' : `私人（QQ ${registered.qqid}）`}\n确认码：${token}\n请在 5 分钟内发送：码表管理 确认删除 ${token}`,
        '管理员删除确认'
    );
}

async function handleAdminDeleteConfirmation(e, token) {
    const scheme = adminDeleteConfirmations.consume(e.sender.user_id, token);
    const cleanupError = await deleteRegisteredScheme(scheme);
    await sendQuotedText(
        e,
        cleanupError
            ? `方案“${scheme.name}”的数据库登记已删除，已不可查询，但残留文件清理失败，请检查日志。`
            : `方案“${scheme.name}”已删除。`,
        '管理员删除结果'
    );
}

bot.on("message.private", async e => {
    if (!isWordHintAdmin(e.sender.user_id)) return;
    const text = extractDirectAdminCommandText(e.message);
    if (text !== '码表管理' && !text.startsWith('码表管理 ')) return;
    try {
        const command = parseWordHintAdminCommand(text);
        if (command.action === 'help') await sendQuotedText(e, WORD_HINT_ADMIN_HELP, '管理员码表帮助');
        else if (command.action === 'list') await listAdminSchemes(e, command);
        else if (command.action === 'show') await showAdminScheme(e, command.name);
        else if (command.action === 'lookup-qq') await lookupAdminPrivateSchemeByQq(e, command.qqid);
        else if (command.action === 'ownership') {
            const result = await changeAdminSchemeOwnership(command);
            await sendQuotedText(
                e,
                `方案归属已调整\n方案：${command.name}\n原归属：${formatSchemeOwner(result.before)}\n新归属：${formatSchemeOwner(result.after)}`,
                '管理员调整方案归属'
            );
        }
        else if (command.action === 'rename') {
            const result = await renameAdminScheme(command);
            const cancelledText = result.cancelledUploads > 0
                ? `\n已取消相关未完成上传：${result.cancelledUploads} 个`
                : '';
            await sendQuotedText(
                e,
                `方案重命名完成\n归属：${formatSchemeOwner(result.scheme)}\n原名称：${command.oldName}\n新名称：${command.newName}${cancelledText}`,
                '管理员重命名方案'
            );
        }
        else if (command.action === 'upload') await runAdminUpload(e, command);
        else if (command.action === 'cancel-upload') {
            const result = cancelLatestUserUpload(`admin:${e.sender.user_id}`, command.name);
            const message = result.state === 'none'
                ? '当前没有管理员上传任务。'
                : result.state === 'committing'
                    ? `无法取消：方案“${result.name}”已经进入最终登记阶段。`
                    : result.state === 'cancelling'
                        ? `方案“${result.name}”的取消请求正在处理中。`
                        : `已接受方案“${result.name}”的取消请求，正在停止任务并清理临时文件。`;
            await sendQuotedText(e, message, '管理员取消上传');
        } else if (command.action === 'set') {
            await setAdminSchemeConfig(command);
            await sendQuotedText(e, `方案“${command.name}”的${command.field}已设置。`, '管理员设置配置');
        } else if (command.action === 'delete') await handleAdminDeleteRequest(e, command.name);
        else if (command.action === 'confirm-delete') await handleAdminDeleteConfirmation(e, command.token);
    } catch (err) {
        console.warn('管理员码表命令失败:', err.message || err);
        await sendQuotedText(e, `码表管理失败：${err.userMessage || err.message || '未知错误'}`, '管理员码表错误');
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
        if (strs[0] === '取消上传') {
            if (strs.length > 2) {
                await sendQuotedText(e, '正确格式：取消上传 [方案名]', '取消上传回复');
                return;
            }
            const result = cancelLatestUserUpload(e.sender.user_id, strs[1] || null);
            if (result.state === 'none') {
                await sendQuotedText(e, '当前没有正在下载、排队、构建或发布的词提上传任务。', '取消上传回复');
            } else if (result.state === 'cancelling') {
                await sendQuotedText(
                    e,
                    `上传取消处理中\n方案：${result.name}\n当前阶段：${result.phase || '清理临时文件'}\n任务已经收到取消请求，请等待原上传消息返回最终取消结果。`,
                    '取消上传回复'
                );
            } else if (result.state === 'committing') {
                await sendQuotedText(
                    e,
                    `无法取消上传\n方案：${result.name}\n当前阶段：${result.phase || '最终登记'}\n原因：任务已经进入不可安全中断的最终登记阶段。它会先完成；如果需要替换，可以直接提交新的上传。`,
                    '取消上传回复'
                );
            } else {
                await sendQuotedText(
                    e,
                    `已接受取消请求\n方案：${result.name}\n取消时阶段：${result.phase || '处理中'}\n正在停止任务并清理临时文件；原上传消息稍后会收到取消结果。`,
                    '取消上传回复'
                );
            }
            return;
        }
        if (strs[0] === '删除词提') {
            if (strs.length > 2) {
                await sendQuotedText(e, '正确格式：删除词提 [方案名]', '删除词提回复');
                return;
            }
            const userId = String(e.sender.user_id);
            try {
                const deletedName = await withUserMutation(userId, async () => {
                    const records = await getOwnedPrivateSchemes(userId);
                    const name = resolveOwnedScheme(records, strs[1] || null, '删除词提 <方案名>');
                    return withSchemeMutations([name], async () => {
                        const current = await run_mysql(`select name from private_word_base where qqid = ${mysql.escape(userId)} and name = ${mysql.escape(name)}`);
                        if (current.length !== 1) throw new AdminCommandError('方案登记在等待操作期间发生变化，请重试。');
                        const base = schemePath(name);
                        await run_mysql(`delete from private_word_base where qqid = ${mysql.escape(userId)} and name = ${mysql.escape(name)}`);
                        try {
                            word_hint.remove(base);
                            await removeRegularWorkerScheme(base);
                            removeSchemeStorage(name);
                        } catch (cleanupError) {
                            // Registration is already gone, so leftovers are
                            // unreachable and must not turn a successful delete
                            // into a misleading failure response.
                            console.warn('已删除词提的文件清理失败:', cleanupError.message || cleanupError);
                        }
                        return name;
                    });
                });
                e.quick_action([Structs.text(`方案“${deletedName}”删除成功`)]);
            } catch (err) {
                e.quick_action([Structs.text(err.message || '删除失败')]);
            }
            return;
        }
        if (strs[0] === '查看方案配置') {
            if (strs.length > 2) {
                e.quick_action([Structs.text('正确格式：查看方案配置 [方案名]')]);
            } else {
                try {
                    const rows = await getOwnedPrivateSchemes(e.sender.user_id);
                    const name = resolveOwnedScheme(rows, strs[1] || null, '查看方案配置 <方案名>');
                    const config = word_hint.get_ext(schemePath(name));
                    e.quick_action([Structs.text(`方案：${name}\n选重键：${config.candidate}\n最大码长：${config.maxlen}\n标点引导键：${config.punct || '无'}`)]);
                } catch (err) {
                    e.quick_action([Structs.text(err.message || '配置读取失败')]);
                }
            }
            return;
        }
        if (strs.length < 1)
            return;
        if (strs[0] === '设置选重键') {
            const userId = String(e.sender.user_id);
            try {
                const changedName = await withUserMutation(userId, async () => {
                    const rows = await getOwnedPrivateSchemes(userId);
                    const args = strs.slice(1);
                    const selection = resolveUserConfigSelection(rows, args, '设置选重键 <方案名> <值|默认>');
                    const { name } = selection;
                    const value = normalizeAdminConfigValue('选重键', selection.value || '默认');
                    return withSchemeMutations([name], async () => {
                        const current = await run_mysql(`select name from private_word_base where qqid = ${mysql.escape(userId)} and name = ${mysql.escape(name)}`);
                        if (current.length !== 1) throw new AdminCommandError('方案登记在等待操作期间发生变化，请重试。');
                        await updateSchemeConfigAtomically(name, config => {
                            config.candidate = value;
                        });
                        return name;
                    });
                });
                e.quick_action([Structs.text(`方案“${changedName}”设置完毕`)]);
            } catch (err) {
                e.quick_action([Structs.text(err.message || '设置失败')]);
            }
        }
        else if (strs[0] === '设置最大码长') {
            const userId = String(e.sender.user_id);
            try {
                const changedName = await withUserMutation(userId, async () => {
                    const rows = await getOwnedPrivateSchemes(userId);
                    const args = strs.slice(1);
                    const selection = resolveUserConfigSelection(rows, args, '设置最大码长 <方案名> <整数|默认>');
                    const { name } = selection;
                    const value = normalizeAdminConfigValue('最大码长', selection.value || '默认');
                    return withSchemeMutations([name], async () => {
                        const current = await run_mysql(`select name from private_word_base where qqid = ${mysql.escape(userId)} and name = ${mysql.escape(name)}`);
                        if (current.length !== 1) throw new AdminCommandError('方案登记在等待操作期间发生变化，请重试。');
                        await updateSchemeConfigAtomically(name, config => {
                            config.maxlen = value;
                        });
                        return name;
                    });
                });
                e.quick_action([Structs.text(`方案“${changedName}”设置完毕`)]);
            } catch (err) {
                e.quick_action([Structs.text(err.message || '设置失败')]);
            }
        }
        else if (strs[0] === '设置标点引导键') {
            const userId = String(e.sender.user_id);
            try {
                const changedName = await withUserMutation(userId, async () => {
                    const rows = await getOwnedPrivateSchemes(userId);
                    const args = strs.slice(1);
                    const selection = resolveUserConfigSelection(rows, args, '设置标点引导键 <方案名> <值|无|默认>');
                    const { name } = selection;
                    const value = normalizeAdminConfigValue('标点引导键', selection.value || '无');
                    return withSchemeMutations([name], async () => {
                        const current = await run_mysql(`select name from private_word_base where qqid = ${mysql.escape(userId)} and name = ${mysql.escape(name)}`);
                        if (current.length !== 1) throw new AdminCommandError('方案登记在等待操作期间发生变化，请重试。');
                        await updateSchemeConfigAtomically(name, config => {
                            config.punct = value;
                        });
                        return name;
                    });
                });
                e.quick_action([Structs.text(`方案“${changedName}”设置完毕`)]);
            } catch (err) {
                e.quick_action([Structs.text(err.message || '设置失败')]);
            }
        }
        else if (strs[0] === '上传词提') {
            const replyUpload = text => sendQuotedText(e, text, '词提上传状态消息');
            if (strs.length !== 2) {
                await replyUpload('上传请求未受理：指令格式不正确。\n正确格式：上传词提 方案名称');
                return;
            }
            let name = strs[1];
            try {
                validateSchemeName(name);
            } catch (validationError) {
                await replyUpload(`上传请求未受理：${validationError.message}`);
                return;
            }
            let uploadFile;
            try {
                uploadFile = await getRepliedWordHintFile(e);
            } catch (fileError) {
                await replyUpload(`上传请求未受理：${fileError.message}`);
                return;
            }
            const sourceFileName = uploadFile.filename;
            const sourceFileSize = uploadFile.size;
            const uploadStartedAt = Date.now();
            const userId = String(e.sender.user_id);
            try {
                assertUserUploadCapacity(await getOwnedPrivateSchemes(userId), name);
            } catch (capacityError) {
                await replyUpload(`上传请求未受理：${capacityError.message}`);
                return;
            }
            const uploadTask = beginLatestUserUpload(userId, name);
            const previousTaskText = uploadTask.previousState === 'cancelled'
                ? `\n已取消你此前尚未完成的上传“${uploadTask.previousName}”。`
                : uploadTask.previousState === 'committing'
                    ? `\n你此前的上传“${uploadTask.previousName}”已进入最终登记阶段，无法安全中断；本任务会排在其后并覆盖它。`
                    : '';
            await replyUpload(
                `上传中...（1/4：下载文件）\n方案：${name}\n文件：${sourceFileName}\n大小：${formatFileSize(sourceFileSize)}${previousTaskText}\n正在下载文件。同名新上传会取消此前尚未进入最终登记阶段的同名任务；不同名任务会分别排队。`
            );
            let version = null;
            let committed = false;
            let uploadResult = null;
            uploadTask.phase = '获取文件下载地址';
            const cleanupUploadVersion = () => {
                if (committed || version === null) return;
                try {
                    removeDirectory(version.directory);
                } catch (cleanupError) {
                    console.warn('上传失败后的临时目录清理失败:', cleanupError.message || cleanupError);
                }
            };
            try {
                const url = await bot.get_private_file_url({ file_id: uploadFile.fileId });
                throwIfUploadSuperseded(uploadTask);
                uploadTask.phase = '创建临时版本';
                version = createSchemeVersion(name);
                throwIfUploadSuperseded(uploadTask);
                uploadTask.phase = '下载文件';
                const response = await fetch(url.url, { signal: uploadTask.controller.signal });
                if (!response.ok || !response.body) throw new Error(`download failed (${response.status})`);
                await pipeline(
                    Readable.fromWeb(response.body),
                    fs.createWriteStream(`${version.base}.txt`),
                    { signal: uploadTask.controller.signal }
                );
                throwIfUploadSuperseded(uploadTask);
                uploadTask.phase = '等待用户和方案操作锁';
                await replyUpload(
                    `上传中...（2/4：等待处理）\n方案：${name}\n文件已下载完成，正在等待该用户及方案的操作锁。等待期间，原方案仍可正常查询。`
                );

                await withUserMutation(userId, async () => {
                    throwIfUploadSuperseded(uploadTask);
                    await withSchemeMutations([name], async () => {
                        throwIfUploadSuperseded(uploadTask);
                        uploadTask.phase = '检查方案名称和归属';
                        // Only checks made while holding both locks authorize
                        // publication. This closes the old check/use race.
                        const [publicRows, privateRows, ownedRows] = await Promise.all([
                            run_mysql(`select * from public_word_base where name = ${mysql.escape(name)}`),
                            run_mysql(`select * from private_word_base where name = ${mysql.escape(name)}`),
                            getOwnedPrivateSchemes(userId)
                        ]);
                        throwIfUploadSuperseded(uploadTask);
                        if (publicRows.length > 0) {
                            const err = new Error('public scheme name is occupied');
                            err.userMessage = '该名字已在公共码表中被使用';
                            throw err;
                        }
                        if (privateRows.length > 1 || (privateRows.length === 1 && String(privateRows[0].qqid) !== userId)) {
                            const err = new Error('private scheme name is occupied');
                            err.userMessage = '该名字已被别人使用';
                            throw err;
                        }
                        assertUserUploadCapacity(ownedRows, name);
                        const updating = privateRows.length === 1;
                        const config = updating ? word_hint.get_ext(schemePath(name)) : null;
                        uploadTask.phase = '等待构建队列';
                        await buildHintAsync(path.resolve(version.base), {
                            signal: uploadTask.controller.signal,
                            onStart: () => {
                                uploadTask.phase = '构建 Hint';
                                return replyUpload(
                                    `上传中...（3/4：构建 Hint）\n方案：${name}\n已轮到本任务，正在生成查询文件。大码表可能需要数分钟，请耐心等待。`
                                );
                            }
                        });
                        throwIfUploadSuperseded(uploadTask);
                        uploadTask.phase = '校验并发布';
                        await replyUpload(
                            `上传中...（4/4：校验并发布）\n方案：${name}\nHint 已构建完成，正在校验文件并原子切换方案版本。`
                        );
                        if (config !== null && !word_hint.set_ext(version.base, config)) {
                            throw new Error('cannot preserve scheme config');
                        }
                        word_hint.get_ext(version.base);
                        if (!word_hint.replace(version.base)) throw new Error('cannot mmap staged hint');
                        word_hint.remove(version.base);
                        const builtHintSize = fs.statSync(`${version.base}.hint`).size;
                        throwIfUploadSuperseded(uploadTask);

                        const publication = publishSchemeVersion(name, version.directory);
                        try {
                            await refreshPublishedScheme(name, publication.oldBase);
                            throwIfUploadSuperseded(uploadTask);
                            uploadTask.phase = '登记方案';
                            // From this point a database statement may commit
                            // even if an AbortSignal fires. Finish this tiny
                            // atomic publication tail, then let the new upload
                            // overwrite it under the same user lock.
                            uploadTask.cancelable = false;
                            if (!updating) {
                                await run_mysql(`insert into private_word_base (qqid, name) values (${mysql.escape(userId)}, ${mysql.escape(name)})`);
                            }
                        } catch (err) {
                            await restorePublishedScheme(name, publication);
                            throw err;
                        }

                        committed = true;
                        uploadResult = { updating, hintSize: builtHintSize };
                        uploadTask.phase = '清理旧版本';
                        try {
                            publication.cleanupPrevious();
                        } catch (cleanupError) {
                            console.warn('旧词提版本清理失败:', cleanupError.message || cleanupError);
                        }
                    });
                });
                const resultText = uploadResult.updating
                    ? '已用本次文件更新同名方案，其他私人方案不受影响。'
                    : '已新增私人词提方案，其他私人方案不受影响。';
                await replyUpload(
                    `上传完成\n方案：${name}\n源文件：${sourceFileName}（${formatFileSize(sourceFileSize)}）\nHint：${formatFileSize(uploadResult.hintSize)}\n用时：${((Date.now() - uploadStartedAt) / 1000).toFixed(1)} 秒\n结果：${resultText}\n新方案已经可以查询。`
                );
            }
            catch (err) {
                console.log(err)
                cleanupUploadVersion();
                if (uploadTask.controller.signal.aborted) {
                    const abortReason = uploadTask.controller.signal.reason;
                    const reasonText = abortReason?.code === 'UPLOAD_CANCELLED'
                        ? '你发送了“取消上传”命令。'
                        : abortReason?.code === 'UPLOAD_SCHEME_RENAMED'
                            ? `管理员正在将方案“${abortReason.oldName}”重命名为“${abortReason.newName}”。`
                            : `你又提交了新的上传请求“${abortReason?.replacementName || '新的方案'}”。`;
                    await replyUpload(
                        `上传已取消\n原任务方案：${name}\n取消时阶段：${uploadTask.phase}\n原因：${reasonText}\n处理结果：本任务的临时文件已清理，尚未覆盖原有方案。`
                    );
                } else {
                    await replyUpload(
                        `上传失败\n方案：${name}\n失败阶段：${uploadTask.phase}\n原因：${err.userMessage || '文件下载、码表格式检查、Hint 构建或发布过程中发生错误。'}\n处理结果：临时文件已清理；如果原来已有方案，原方案不会被本次失败覆盖。`
                    );
                }
            } finally {
                cleanupUploadVersion();
                finishLatestUserUpload(uploadTask);
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
