import { createRequire } from 'module';
import { bot, consql } from './bot.js';
const require = createRequire(import.meta.url);
const rime_plugin = require('../build/Release/rime_plugin2.node');
import puppeteer from 'puppeteer';
import { Structs } from 'node-napcat-ts';
import { get_text_content_from_msg, get_file_buffer, has_reply, get_reply } from './util.js';
import compressing from 'compressing'
import fs from 'fs'
import path from 'node:path'
import mysql from 'mysql'
import { scheduler } from 'timers/promises';
const RIME_SCHEME = `${process.cwd()}/rime_scheme`
async function rime_picture(data) {

    const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox'] })
    const page = await browser.newPage()
    try {
        await page.setViewport({
            width: 1,
            height: 1,
            deviceScaleFactor: 2
        });


        await page.goto(`file://${process.cwd()}/rime_plugin/template.html`, { waitUntil: 'domcontentloaded' });
        // console.dir(content, {depth: null, maxArrayLength: null})
        await page.evaluate(data => {
            function renderIME(container, data) {
                container.innerHTML = '';

                // 渲染 preedit
                const preeditDiv = document.createElement('div');
                preeditDiv.className = 'preedit';

                let inSel = false;

                data.preedit.forEach(item => {
                    if (item.type === 'text') {
                        const span = document.createElement('span');
                        span.textContent = item.data;
                        if (inSel) span.className = 'sel';
                        preeditDiv.appendChild(span);
                    } else if (item.type === 'sel_start') {
                        inSel = true;
                    } else if (item.type === 'sel_end') {
                        inSel = false;
                    } else if (item.type === 'cursor') {
                        const cursor = document.createElement('span');
                        cursor.className = 'cursor';
                        preeditDiv.appendChild(cursor);
                    }
                });

                container.appendChild(preeditDiv);

                // 渲染候选列表
                const ul = document.createElement('ul');
                ul.className = 'candidate-list';

                data.menu.candidate.forEach((c, idx) => {
                    const li = document.createElement('li');
                    if (c.highlighted) li.classList.add('highlighted');

                    const index = document.createElement('span');
                    index.className = 'candidate-index';
                    index.textContent = `${idx + 1}.`;

                    const text = document.createElement('span');
                    text.className = 'candidate-text';
                    text.textContent = c.text;

                    const comment = document.createElement('span');
                    comment.className = 'candidate-comment';
                    comment.textContent = c.comment;

                    li.appendChild(index);
                    li.appendChild(text);
                    li.appendChild(comment);
                    ul.appendChild(li);
                });

                container.appendChild(ul);

                // 页码信息
                // const pageInfo = document.createElement('div');
                // pageInfo.className = 'page-info';
                // pageInfo.textContent = `${data.menu.page_no + 1}`;
                // container.appendChild(pageInfo);
            }

            renderIME(document.getElementById('ime'), data);
        }, data);
        await page.waitForNetworkIdle({ idleTime: 50 })
        // bot.logger.warn(await page.content());
        let res = await page.screenshot({ encoding: 'binary', fullPage: true, type: 'webp', quality: 50 });
        // await browser.close();
        await browser.close();
        return res;
    } catch (err) {
        await browser.close();
        console.log(err)
        return null;
    }
}



bot.on("message", async e => {
    try {
        let txt = (await get_text_content_from_msg(e.message, false)).join('').trimStart().trim();

        if (txt !== "rime列表") {
            return;
        }

        let que = await run_mysql(`select * from rime`);
        let res = []
        let look_up = {}
        for (let i = 0; i < que.length; i++) {
            if (!(que[i]['name'] in look_up)) {
                look_up[que[i]['name']] = {}
                let res = rime_plugin.get_schema_list(`${RIME_SCHEME}/${que[i]['name']}`);
                for (let elem of res) {
                    look_up[que[i]['name']][elem['schema_id']] = elem['name']
                }
            }
            let desc = '无名'
            if (que[i]['schema_id'] in look_up[que[i]['name']]) {
                desc = look_up[que[i]['name']][que[i]['schema_id']]
            }
            res.push({ name: que[i]['name'], call_name: que[i]['call_name'], schema_id: que[i]['schema_id'], desc: desc });
        }


        // console.log(res)
        if (res.length > 0) {
            let login_info = await bot.get_login_info()
            let msg_list = []
            for (let i = 0; i < res.length; i++) {
                msg_list.push({
                    type: "node",
                    data: {
                        user_id: login_info.user_id,
                        nickname: login_info.nickname,
                        content: [Structs.text(`${res[i]['call_name']}: ${res[i]['desc']}\n${res[i]['schema_id']}@${res[i]['name']}`)]
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
            // bot.send_msg({
            //     message_type: e.message_type,
            //     group_id: e.group_id,
            //     user_id: e.user_id,
            //     message: [Structs.text(res.map(ee => `${ee['call_name']} \t ${ee['schema_id']}@${ee['name']}`).join('\n'))]
            // })
        } else {
            bot.send_msg({
                message_type: e.message_type,
                group_id: e.group_id,
                user_id: e.user_id,
                message: [Structs.text("目前还没有rime方案")]
            })
        }


    } catch (err) {
        console.log(err)
    }
});

async function query_cmd_exist(call_name) {
    let res;
    res = await run_mysql(`select * from rime where call_name = ${mysql.escape(call_name)}`);
    if (res.length > 0) {
        return { name: res[0]['name'], schema_id: res[0]['schema_id'] }
    } else {
        return null;
    }
}

bot.on("message", async e => {
    try {
        if (has_reply(e.message)) {
            return;
        }
        let txt = (await get_text_content_from_msg(e.message, false)).join('').trimStart();

        let pos = txt.search(/\s/);

        if (pos == -1) return;



        let cmd = txt.slice(0, pos);
        txt = txt.slice(pos + 1);

        if (cmd[0] !== '$') return;
        cmd = cmd.slice(1)

        if (cmd.length <= 0) return;

        let info = await query_cmd_exist(cmd)
        if (info === null) return;
        let res = rime_plugin.simulate_key(`${RIME_SCHEME}/${info.name}`, `${info.schema_id}`, txt);


        if ('commit' in res) {
            bot.send_msg({
                message_type: e.message_type,
                group_id: e.group_id,
                user_id: e.user_id,
                message: [Structs.text(res.commit)]
            })
        }

        if ('preedit' in res) {
            let pic = await rime_picture(res)
            bot.send_msg({
                message_type: e.message_type,
                group_id: e.group_id,
                user_id: e.user_id,
                message: [Structs.image(pic)]
            })
        }

        if ('error' in res) {
            bot.send_msg({
                message_type: e.message_type,
                group_id: e.group_id,
                user_id: e.user_id,
                message: [Structs.text(res.error)]
            })
        }



    } catch (err) {
        console.log(err)
    }
})

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

bot.on('message', async e => {
    try {
        let strs = "";
        for (let tmp of e.message) {
            if (tmp.type === 'text') {
                strs += tmp.data.text;
                strs += " ";
            }
        }
        strs = strs.trim().split(/\s+/);
        if (strs.length < 1)
            return;
        if (strs[0] === '部署rime') {
            if (strs.length < 2) {
                return;
            }
            let name = strs[1];
            e.quick_action([Structs.text("部署中...")]);
            rime_plugin.deploy(`${RIME_SCHEME}/${name}`)
            e.quick_action([Structs.text("部署完成")])
            return;
        } else if (strs[0] === 'rime键名') {
            let rep = fs.readFileSync(`${RIME_SCHEME}/desc.txt`);
            // console.log(rep);
            bot.send_msg({
                "message_type": e.message_type,
                "user_id": e.user_id,
                "group_id": e.group_id,
                "message": [Structs.text(rep.toString("utf8"))]
            })
        }
    } catch (ee) {
        e.quick_action(String(ee))
        console.log(ee);
    }

})

bot.on("message", async e => {

    if (e.sender.user_id !== 1144107042) return
    try {
        let strs = "";
        for (let tmp of e.message) {
            if (tmp.type === 'text') {
                strs += tmp.data.text;
                strs += " ";
            }
        }
        strs = strs.trim().split(/\s+/);
        if (strs.length < 1)
            return;
        if (strs[0] === '删除rime') {
            if (strs.length < 2) {
                return;
            }
            let name = strs[1];
            // let records = await run_mysql(`select * from rime where name = ${mysql.escape(name)}`);
            if (fs.existsSync(`${RIME_SCHEME}/${name}`)) {
                fs.rmSync(`${RIME_SCHEME}/${name}`, { recursive: true, force: true });
            }
            // if (records.length > 0) {
            //     await run_mysql(`delete from rime where name = ${mysql.escape(name)}`);
            // }
            e.quick_action([Structs.text("删除成功")]);
            return;
        }
        if (strs[0] === '上传rime') {
            if (!has_reply(e.message)) {
                return;
            }
            if (strs.length < 2) {
                return;
            }
            let id = get_reply(e.message)
            // console.log(id)
            if (typeof id === "undefined") {
                e.quick_action([Structs.text('无法找到消息，请重新上传。')]);
                return;
            }

            let msg = await bot.get_msg({ message_id: id });

            // if (msg.message_type !== 'private') {
            //     e.quick_action([Structs.text('回复的消息不是私聊消息。')]);
            //     return;
            // }
            if (msg.message.length < 1) {
                e.quick_action([Structs.text('回复的消息链长度为0')]);
                return;
            }
            if (msg.message[0].type !== 'file') {
                e.quick_action([Structs.text('回复的消息不是文件消息。')]);
                return;
            }

            let name = strs[1];

            if ((/[\\\\/:*?\"\'<>|]/g).test(strs[1])) {
                e.quick_action([Structs.text('禁止使用该名字！')]);
                return;
            }
            // let que = await run_mysql(`select * from rime where name = ${mysql.escape(name)} or call_name = ${mysql.escape(call_name)}`);
            // if (que.length > 0) {
            //     e.quick_action([Structs.text('该方案名称或调用名称已被使用')]);
            //     return;
            // }

            e.quick_action([Structs.text("上传中...")]);
            let file_buffer = await get_file_buffer(msg.message[0], msg.message_type);


            if (fs.existsSync(`${RIME_SCHEME}/${name}`)) {
                fs.rmSync(`${RIME_SCHEME}/${name}`, { recursive: true, force: true });
            }


            const file_name = path.basename(msg.message[0].data.file || `upload-${Date.now()}.zip`);
            fs.writeFileSync(`${RIME_SCHEME}/${file_name}`, file_buffer);
            // e.quick_action([Structs.text("解压中...")])

            try {
                await compressing.zip.uncompress(`${RIME_SCHEME}/${file_name}`, `${RIME_SCHEME}/${name}/`)
            } catch (e) {
                e.quick_action([Structs.text("解压失败")])
                fs.rmSync(`${RIME_SCHEME}/${file_name}`);
                return;
            }
            fs.rmSync(`${RIME_SCHEME}/${file_name}`);
            e.quick_action([Structs.text("上传完成")])

            return;
        }

        if (strs[0] === '设置rime指令') {
            if (strs.length < 4) {
                return;
            }
            let name = strs[3];
            let call_name = strs[1];
            let schema_id = strs[2];
            let records = await run_mysql(`select * from rime where call_name = ${mysql.escape(call_name)}`);
            if (records.length > 0) {
                await run_mysql(`delete from rime where call_name = ${mysql.escape(call_name)}`);
            }
            await run_mysql(`insert into rime values(${mysql.escape(name)}, ${mysql.escape(call_name)}, ${mysql.escape(schema_id)})`)
            e.quick_action([Structs.text("设置完成")])
            return;
        }
        if (strs[0] === '删除rime指令') {
            if (strs.length < 2) {
                return;
            }
            let call_name = strs[1];
            let records = await run_mysql(`select * from rime where call_name = ${mysql.escape(call_name)}`);
            if (records.length > 0) {
                await run_mysql(`delete from rime where call_name = ${mysql.escape(call_name)}`);
            }
            e.quick_action([Structs.text("删除完成")])
            return;
        }
        if (strs[0] === '方案列表') {
            e.quick_action(String(fs.readdirSync(RIME_SCHEME)))
            return;
        }
    }
    catch (ee) {
        e.quick_action(String(ee))
        console.log(ee);
    }
})
