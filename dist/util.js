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

export async function get_file_buffer(file, messageType = null, groupId = null) {
    const fileId = file?.data?.file_id;
    if (!fileId) throw new Error('文件缺少 file_id。');
    const groupFileUrl = async () => {
        const numericGroupId = Number(groupId);
        if (!Number.isSafeInteger(numericGroupId) || numericGroupId <= 0) {
            throw new Error('群文件缺少 group_id。');
        }
        return bot.get_group_file_url({ group_id: numericGroupId, file_id: fileId });
    };
    const privateFileUrl = () => bot.get_private_file_url({ file_id: fileId });
    const methods = messageType === 'group'
        ? [groupFileUrl]
        : messageType === 'private'
            ? [privateFileUrl]
            : [privateFileUrl, groupFileUrl];
    let lastError;
    for (const getUrl of methods) {
        try {
            const info = await getUrl();
            if (!info?.url) throw new Error('文件下载地址为空。');
            const response = await fetch(info.url);
            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            return Buffer.from(await response.arrayBuffer());
        } catch (error) { lastError = error; }
    }
    throw lastError || new Error('无法获取文件下载地址。');
}

/**
 * 
 * @param {import('node-napcat-ts').Receive[keyof import('node-napcat-ts').Receive][]} msg 
 * @returns {Promise<string[]>}
 */
export async function get_text_content_from_msg(msg, read_file=true, messageType=null, groupId=null) {
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
                res = res.concat(await get_text_content_from_msg(reply.message, read_file, reply.message_type, reply.group_id))
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
                        res = res.concat(await get_text_content_from_msg(e.message, read_file, e.message_type, e.group_id))
                        // res.push(`${await get_text_content_from_msg(e.message)}`)
                    }
                } catch (e) {
                    res.push(`[转发消息]`)
                }
            } else {
                let forward = tmp.data.content
                for (let e of forward) {
                    res = res.concat(await get_text_content_from_msg(e.message, read_file, e.message_type, e.group_id))
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
                    const buf = await get_file_buffer(tmp, messageType, groupId);
                    res.push(buf.toString('utf-8'))
                } catch (error) {
                    console.warn('读取文件消息内容失败:', error.message || error);
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
