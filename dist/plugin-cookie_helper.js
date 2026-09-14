import { Structs } from "node-napcat-ts"
import { bot } from "./bot.js"

const table = {
    '万': Math.pow(10, 4),
    '亿': Math.pow(10, 8),
    '兆': Math.pow(10, 12),
    '京': Math.pow(10, 16),
    '垓': Math.pow(10, 20),
    '秭': Math.pow(10, 24),
    '穰': Math.pow(10, 28),
    '沟': Math.pow(10, 32),
    '涧': Math.pow(10, 36),
    '正': Math.pow(10, 40),
    '载': Math.pow(10, 44),
    '极': Math.pow(10, 48),
    '恒河沙': Math.pow(10, 52),
    '阿僧祇': Math.pow(10, 56),
    '那由他': Math.pow(10, 60),
    '不可思议': Math.pow(10, 64),
    '无量': Math.pow(10, 68),
    '大数': Math.pow(10, 72),
    '全仕祥': Math.pow(10, 76)
}

/**
 * 
 * @param {string} str 
 * @param {string} unit
 */
function text_to_float(str, unit) {
    let reg2 = /[万亿兆京垓秭穰沟涧正载极恒河沙阿僧祇那由他不可思议无量大数全仕祥]+/g
    let arr = reg2.exec(unit)
    if (arr === null) {
        unit = ''
    } else {
        unit = arr[0]
    }

    let res = Number(str)
    if (Object.hasOwn(table, unit)) {
        res *= table[unit]
    }
    return res
}

/**
 * 
 * @param {string} str 
 * @param {string} unit
 */
function text_to_float2(str, unit) {
    let reg2 = /[万亿兆京垓秭穰沟涧正载极恒河沙阿僧祇那由他不可思议无量大数全仕祥]+/g
    let arr = reg2.exec(unit)
    if (arr === null) {
        unit = ''
    } else {
        unit = arr[0]
    }
    return str + unit
}


function extract_type_and_number(txt) {
    let reg1 = /[0-9]+\.(.+?) 价格:([\d\.]+)(.*?) 基础秒收益:([\d\.]+)(.*?)[\r\n]/g
    let ans = []
    let res
    while (res = reg1.exec(txt)) {
        let e = {
            type: res[1],
            price: text_to_float(res[2], res[3]),
            value: text_to_float(res[4], res[5]),
        }
        // e.time = (e.price / e.value).toExponential(6)
        ans.push(e)

    }
    return ans
}

function extract_type_and_number2(txt) {
    let reg1 = /[0-9]+\.(.+?)\*[0-9]+ 秒收益:([\d\.]+)(.*?)[\r\n]/g
    let ans = []
    let res
    while (res = reg1.exec(txt)) {
        let e = {
            type: res[1],
            value: text_to_float(res[2], res[3]),
        }
        ans.push(e)
    }
    return ans
}

function extract_efficiency2(txt) {
    let reg1 = /当前一秒所生产饼干量：([\d\.]+)(.*?)[\r\n]/g
    let res = reg1.exec(txt)
    // console.log(txt)
    // console.log(res)
    // console.log(res[1])
    // console.log(res[2])
    return text_to_float2(res[1], res[2])
}

function extract_efficiency(txt) {
    let reg1 = /当前一秒所生产饼干量：([\d\.]+)(.*?)[\r\n]/g
    let res = reg1.exec(txt)
    // console.log(txt)
    // console.log(res)
    // console.log(res[1])
    // console.log(res[2])
    return text_to_float(res[1], res[2])
}

function is_check(txt) {
    let reg2 = /当前一秒所生产饼干量：/g
    let res = reg2.exec(txt)
    return res !== null
}

function is_buy(txt) {
    let reg2 = /当前可购买建筑：/g
    let res = reg2.exec(txt)
    return res !== null
}

function is_get_gold(txt) {
    let reg3 = /恭喜你获得了一块黄金饼干！/g
    let res = reg3.exec(txt)
    return res !== null
}

function extract_id(txt) {

    let reg3 = /at_tinyid=(\d+)/g
    let res = reg3.exec(txt)
    if (res !== null && res.length >= 2) {
        return res[1]
    } else {
        return '3230662891'
    }
}




bot.on('message.group', e => {
    if (e.message[0].type !== 'reply') {
        return;
    }
    let cmd = ""
    for (let t of e.message) {
        if (t.type === 'text') {
            cmd += t.data.text
            cmd += ' '
        }
    }
    cmd = cmd.trim().split(/\s+/)

    if (cmd < 2) {
        return;
    }

    if (isNaN(cmd[0])) {
        return;
    }

    let reg = /([\d\.]+)(.*)/g
    let res = reg.exec(cmd[1])
    if (res === null) {
        return;
    }
    cmd[0] = Number(cmd[0])
    cmd[1] = text_to_float(res[1], res[2])

    bot.get_msg({ message_id: e.message[0].data.id }).then(
        e => {
            if (e.message[0].type !== 'markdown') {
                return;
            }
            if (e.user_id !== 3889000944) {
                return;
            }
            if (!is_buy(e.message[0].data.content)) {
                return;
            }
            let tmp_res = extract_type_and_number(e.message[0].data.content)
            let res = tmp_res.map(e => [`${e.type}: ${(e.price / cmd[0] / e.value + e.price / cmd[1]).toExponential(2)} 秒\n((${(e.price / cmd[0] / e.value).toExponential(2)})+(${(e.price / cmd[1]).toExponential(2)})) 秒`, e.price / cmd[0] / e.value + e.price / cmd[1], e.type])
            res = res.sort((a, b) => a[1] - b[1])
            let res_msg = res.map(e => e[0]).join('\n')


            // console.log(res_msg)
            bot.send_msg({
                message_type: e.message_type,
                group_id: e.group_id,
                user_id: e.user_id,
                message: [
                    Structs.at(extract_id(e.message[0].data.content)),
                    Structs.text('\n'),
                    Structs.text(res_msg)
                ]
            })

            if (res.length > 0) {
                bot.send_msg(
                    {
                        message_type: e.message_type,
                        group_id: e.group_id,
                        user_id: e.user_id,
                        message: [
                            Structs.text(`购买${res[0][2]}*1`)
                        ]
                    }
                )
            }
        }
    ).catch(() => { })


})

bot.on('message.group', e => {
    if (e.message[0].type !== 'markdown') {
        return;
    }
    if (e.user_id !== 3889000944) {
        return;
    }
    // console.log(is_check(e.message[0].data.content))
    if (!is_check(e.message[0].data.content)) {
        return;
    }
    let res1 = extract_type_and_number2(e.message[0].data.content)
    let sum = 0
    for (let e of res1) {
        sum += e.value
    }
    let res2 = extract_efficiency(e.message[0].data.content)
    let ans = res2 / sum
    // console.log(res2)
    // console.log(sum)
    // console.log(ans)
    let res_msg = `${ans.toFixed(6)} ${extract_efficiency2(e.message[0].data.content)}`
    // console.log(res_msg)
    bot.send_msg({
        message_type: e.message_type,
        group_id: e.group_id,
        user_id: e.user_id,
        message: [
            Structs.text(res_msg),
            Structs.text('\n'),
            Structs.at(extract_id(e.message[0].data.content))
        ]
    })
})


bot.on('message.group', e => {
    if (e.message[0].type !== 'markdown') {
        return;
    }
    if (e.user_id !== 3889000944) {
        return;
    }
    if (!is_get_gold(e.message[0].data.content)) {
        return;
    }

    setTimeout(() => {
        bot.send_msg({
            message_type: e.message_type,
            group_id: e.group_id,
            user_id: e.user_id,
            message: [
                Structs.at(extract_id(e.message[0].data.content)),
                Structs.text('\n'),
                Structs.text('可以领取黄金饼干了！')
            ]
        })
    }, 600000)

    bot.send_msg({
        message_type: e.message_type,
        group_id: e.group_id,
        user_id: e.user_id,
        message: [
            Structs.at(extract_id(e.message[0].data.content)),
            Structs.text('\n'),
            Structs.text('届时会提醒：可以领取黄金饼干了！')
        ]
    })
})

bot.on('message', e => {
    let cmds = "";
    for (let it of e.message) {
        if (it.type === "text") {
            cmds += it.data.text;
            cmds += " ";
        }
    }
    cmds = cmds.trim();
    cmds = cmds.split(/\s+/)
    if (cmds.length < 3) return;
    if (cmds[0] !== '提醒') {
        return;
    }
    if (Number.isNaN(cmds[1])) {
        return;
    }
    let delay = Number(cmds[1])
    if (delay < 0) {
        return;
    }
    delay *= 1000

    setTimeout(() => {
        bot.send_msg({
            message_type: e.message_type,
            group_id: e.group_id,
            user_id: e.user_id,
            message: [
                Structs.at(e.user_id),
                Structs.text('\n'),
                Structs.text(cmds[2])
            ]
        })
    }, delay)
    bot.send_msg({
        message_type: e.message_type,
        group_id: e.group_id,
        user_id: e.user_id,
        message: [
            Structs.at(e.user_id),
            Structs.text('\n'),
            Structs.text(`届时会提醒：${cmds[2]}`)
        ]
    })
})
