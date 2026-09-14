import { bot } from "./bot.js";
/**  */

export function has_reply(msg) {
    for (let e of msg) {
        if (e.type === 'reply') {
            return true;
        }
    }
    return false;
}

export function get_reply(msg) {
    for (let e of msg) {
        if (e.type === 'reply') {
            return e.data.id;
        }
    }
}

/**
 * 
 * @param {import('node-napcat-ts').Receive[keyof import('node-napcat-ts').Receive][]} msg 
 * @returns {Promise<string[]>}
 */
export async function get_text_content_from_msg(msg, read_file=true) {
    let res = []
    // console.log(msg)
    for (let tmp of msg) {
        if (tmp.type === 'text') {
            res.push(tmp.data.text)
        } else if (tmp.type === 'at') {
            if (tmp.data.qq === 'all') {
                res.push(`@全体成员`)
            } else {
                let stranger_info = await bot.get_stranger_info({ user_id: tmp.data.qq })
                res.push(`@${stranger_info.nickname}`)
            }
        } else if (tmp.type === 'face') {
            res.push(`[${tmp.data.id}号表情]`)
        } else if (tmp.type === 'reply') {
            try {
                let reply = await bot.get_msg({ message_id: tmp.data.id })
                res = res.concat(await get_text_content_from_msg(reply.message))
                // res.push(`${await get_text_content_from_msg(reply.message)}`)
            } catch (e) {
                res.push(`[引用]`)
            }


        } else if (tmp.type === 'record') {
            res.push(`[语音]`)
        } else if (tmp.type === 'forward') {
            if (typeof (tmp.data.content) === 'undefined') {
                try {
                    let forward = await bot.get_forward_msg({ message_id: tmp.data.id })
                    for (let e of forward.messages) {
                        res = res.concat(await get_text_content_from_msg(e.message))
                        // res.push(`${await get_text_content_from_msg(e.message)}`)
                    }
                } catch (e) {
                    res.push(`[转发消息]`)
                }
            } else {
                let forward = tmp.data.content
                for (let e of forward) {
                    res = res.concat(await get_text_content_from_msg(e.message))
                    // res.push(`${await get_text_content_from_msg(e.message)}`)
                }
            }
        } else if (tmp.type === 'dice') {
            res.push(`[骰子]`)
        } else if (tmp.type === 'json') {
            res.push(`[json消息]`)
        } else if (tmp.type === 'file') {
            let ext = tmp.data.file.slice(tmp.data.file.lastIndexOf('.') + 1);
            if (!read_file || ext !== 'txt' || Number(tmp.data.file_size) > 1 * 1024 * 1024) {
                res.push(`[文件]`)
            } else {
                try {
                    let file_info = await bot.get_file({ file_id: tmp.data.file_id });
                    if (typeof (file_info) === 'undefined') {
                        res.push(`[文件]`)
                    } else {
                        let buf = Buffer.from(file_info.base64, 'base64').toString('utf-8')
                        res.push(buf)
                    }
                } catch (error) {
                    res.push(`[文件]`)
                }
            }

        } else if (tmp.type === 'markdown') {
            res.push(`[markdown消息]`)
        } else if (tmp.type === 'image') {
            if (tmp.data.summary === '') {
                res.push("[图片]")
            } else {
                res.push(tmp.data.summary)
            }
        } else if (tmp.type === 'poke') {
            res.push(`[戳一戳]`)
        } else if (tmp.type === 'rps') {
            res.push(`[猜拳]`)
        } else if (tmp.type === 'video') {
            res.push(`[视频]`)
        } else {
            res.push(`[${tmp.type}]`)
        }
    }
    // console.log(res)
    return res
}