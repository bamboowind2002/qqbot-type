import { bot } from './bot.js'
import { Structs } from 'node-napcat-ts';
import { get_reply, has_reply, get_text_content_from_msg } from './util.js';

bot.on('message', async e => {
    // if (e.sender.user_id !== 1144107042) {
    //     return;
    // }
    let cmds = "";
    for (let it of e.message) {
        if (it.type === "text") {
            cmds += it.data.text;
            cmds += " ";
        }
    }
    cmds = cmds.trim();
    if (!has_reply(e.message)) {
        return;
    }

    let id = get_reply(e.message);
    if (typeof id === 'undefined') {
        return;
    }
    let res = await bot.get_msg({ message_id: id });
    // console.log(cmds)
    if (cmds === '取') {

        let login_info = await bot.get_login_info();
        let msg_list = [];

        for (let i = 0; i < res.message.length; i++) {
            msg_list.push({
                type: "node",
                data: {
                    user_id: login_info.user_id,
                    nickname: login_info.nickname,
                    content: [Structs.text(JSON.stringify(res.message[i]))]
                }
            })
        }
        // console.dir(msg_list, {depth: null})
        // msg_list.push({
        //     type: "node",
        //     data: {
        //         user_id: login_info.user_id,
        //         nickname: login_info.nickname,
        //         content: Structs.text(await get_text_content_from_msg(res.message))
        //     }
        // })

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


    } else if (cmds === '重复') {
        bot.send_msg({
            message_type: e.message_type,
            group_id: e.group_id,
            user_id: e.user_id,
            message: res.message
        })
    } else if (cmds === '撤回') {
        bot.delete_msg({ message_id: id })
    }

})


