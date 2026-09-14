// "use strict";
// var __importDefault = (this && this.__importDefault) || function (mod) {
//     return (mod && mod.__esModule) ? mod : { "default": mod };
// };
// Object.defineProperty(exports, "__esModule", { value: true });
// const index_1 = require("./index");
// const fs_1 = __importDefault(require("fs"));

import { bot } from './bot.js'
import { Structs } from 'node-napcat-ts';
import fs from 'fs'

bot.on("message", e => {
    try {
        let arr = e.raw_message.trim().split(/\s+/);
        if (arr[0] != '大竹帮助')
            return;
        let rep = fs.readFileSync("./help.txt");
        // console.log(rep);
        bot.send_msg({
            "message_type": e.message_type,
            "user_id": e.user_id,
            "group_id": e.group_id,
            "message": [Structs.text(rep.toString("utf8"))]
        })
    }
    catch (err) {
        console.log(err)
    }
    // e.quick_action([Structs.text(rep.toString("utf8"))], false);
});


function stringToUTF32(str) {
    const utf32 = [];

    for (const char of str) {
        const codePoint = char.codePointAt(0); // 获取字符的 Unicode 码点
        utf32.push(codePoint);
    }

    return utf32;
}

function utf32ToString(utf32Array) {
    return String.fromCodePoint(...utf32Array);
}


bot.on("message", async e => {
    let cmds = "";
    for (let it of e.message) {
        if (it.type === "text") {
            cmds += it.data.text;
            cmds += " ";
        }
    }
    cmds = cmds.trim();

    cmds = cmds.split(/\s+/);
    if (cmds.length < 3) return;
    let cmd = cmds[0];
    let seg_len = Number(cmds[1]);
    let delay = Number(cmds[2]);


    if (e.sender.user_id === 1144107042 && cmd === '发指定文本') {
        let rep = fs.readFileSync("./test.txt").toString("utf8");
        let u32 = stringToUTF32(rep)
        let pre_id = -1
        for (let i = 0; i < u32.length; i += seg_len) {
            let now = utf32ToString(u32.slice(i, i + seg_len))
            let msg = []
            if (pre_id != -1) {
                msg.push(Structs.reply(pre_id))
            }
            msg.push(Structs.text(now))
            // console.log(msg)
            try {
                let res = await bot.send_msg({
                    "message_type": e.message_type, "user_id": e.user_id, "group_id": e.group_id, "message": msg
                })
                pre_id = res.message_id
            } catch (e) {
                
            }
            await new Promise(e => { setTimeout(() => { e() }, delay) })
        }

    }
})
