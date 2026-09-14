import { bot } from './bot.js'
// 三条复读
class LastMessage {
    constructor() {
        this.set = new Set();
        this.msg = "";
        this.rpt = [];
        this.isrpt = false;
    }
    /**
     * 更新复读状态
     * @param id QQ号
     * @param content 信息的文本形式
     * @param message 信息
     */
    update_state(id, content, message) {
        // 内容不同，重置isrpt
        if (content !== this.msg)
            this.isrpt = false;
        // 如果前面出现过这个人或内容不同，复读集合重置。
        // 否则增加复读集合
        if (this.set.has(id) || content !== this.msg) {
            this.set.clear();
            this.msg = content;
            this.set.add(id);
            this.rpt = message;
        }
        else {
            this.set.add(id);
        }
    }
}

/**
 * 
 * @param {string} str 
 */
function get_md5(str) {
    str = str.substring(0, str.lastIndexOf("."))
    str = str.replace(/{|}|-/g, '')
    return str
}

function deal_with_image(msg) {
    let res = []
    for (let e of msg) {
        if (e.type === 'image') {
            res.push({
                type: 'image',
                data: { file: get_md5(e.data.file) }
            })
        } else {
            res.push(e)
        }
    }
    return res
}
// 对每个群维护一个LastMessage对象
let m = new Map();
bot.on("message.group", e => {
    let tmp = m.get(e.group_id);
    if (typeof tmp === 'undefined') {
        tmp = new LastMessage();
    }
    // console.log(e.message)
    tmp.update_state(e.sender.user_id, JSON.stringify(deal_with_image(e.message)), e.message);
    // 没有复读过，并发现复读人数>=3
    if (!tmp.isrpt && tmp.set.size >= 3) {
        tmp.isrpt = true;
        bot.send_msg({
            message_type: e.message_type,
            group_id: e.group_id,
            message: e.message
        })
    }
    m.set(e.group_id, tmp);
});
