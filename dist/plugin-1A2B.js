import { bot } from './bot.js'
import { Structs } from 'node-napcat-ts';
/**
 * 获取类型合并id的字符串
 * @param msg 消息
 * @returns 可作为key的字符串
 */
function get_object_string(msg) {
    let id;
    if (msg.message_type === 'group')
        id = msg.group_id;
    else
        id = msg.user_id;
    return `${msg.message_type}_${id}`;
}
/**
 * 对数组进行洗牌
 * @param arr 欲洗牌的数组
 * @returns 洗牌后的结果
 */
function array_shuffle(arr) {
    let res_arr = [];
    let random;
    while (arr.length) {
        random = Math.floor(Math.random() * arr.length);
        res_arr.push(arr[random]);
        arr.splice(random, 1);
    }
    return res_arr;
}
/** 1A2B结果类 */
class Result {
    constructor(A, B) {
        this.A = A;
        this.B = B;
    }
    is_valid() {
        return this.A >= 0 && this.B >= 0;
    }
    to_string() {
        return `${this.A}A${this.B}B`;
    }
}
/**
 * 1A2B游戏类
 */
class Game1A2B {
    constructor(len) {
        if (len >= 10)
            len = 10;
        let tmp = [];
        for (let i = 0; i < 10; i++)
            tmp.push(i);
        tmp = array_shuffle(tmp);
        this.ans = [];
        for (let i = 0; i < len; i++)
            this.ans.push(tmp[i]);
        this.guess_time = 0;
        this.record = [];
    }
    get_record_str() {
        let res = ''
        for (let e of this.record) {
            res += e[0]
            res += ' '
            res += e[1]
            res += '\n'
        }
        return res
    }
    /**
     * 将字符串转化为对应的数组，若长度不合法或非数字则返回null
     * @param str 字符串
     * @returns 对应的数组
     */
    from_string_to_number_array(str) {
        let res = [];
        if (str.length != this.ans.length)
            return null;
        for (let i = 0; i < str.length; i++) {
            let tmp = Number(str[i]);
            if (isNaN(tmp) || tmp < 0 || tmp >= 10)
                return null;
            res.push(tmp);
        }
        return res;
    }
    /**
     * 将答案转化为对应字符串
     * @returns 字符串
     */
    to_string() {
        let res = '';
        for (let i = 0; i < this.ans.length; i++) {
            res += this.ans[i].toString();
        }
        return res;
    }
    /**
     * 获取游戏长度
     * @returns
     */
    get_length() {
        return this.ans.length;
    }
    /**
     * 处理猜测，并返回结果
     * @param guess 猜测
     * @returns
     */
    check(guess) {
        let vis_ans = [];
        let vis_guess = [];
        let vis_num = [];
        if (guess.length != this.ans.length) {
            return new Result(-1, -1);
        }
        let len = guess.length;
        for (let i = 0; i < 10; i++) {
            vis_num.push(false);
        }
        for (let i = 0; i < len; i++) {
            if (isNaN(guess[i]) || guess[i] < 0 || guess[i] >= 10)
                return new Result(-1, -1);
            if (vis_num[guess[i]])
                return new Result(-1, -1);
            vis_num[guess[i]] = true;
            vis_ans.push(false);
            vis_guess.push(false);
        }
        let res = new Result(0, 0);
        for (let i = 0; i < len; i++) {
            if (this.ans[i] === guess[i]) {
                res.A++;
                vis_ans[i] = vis_guess[i] = true;
            }
        }
        for (let i = 0; i < len; i++) {
            if (vis_ans[i])
                continue;
            for (let j = 0; j < len; j++) {
                if (vis_guess[j])
                    continue;
                if (i == j)
                    continue;
                if (this.ans[i] === guess[j]) {
                    res.B++;
                    vis_ans[i] = vis_guess[j] = true;
                }
            }
        }
        this.guess_time++;
        return res;
    }
}
/**
 * 控制所有对象的1A2B游戏的类
 */
class Game1A2BControl {
    constructor() {
        this.global_game_map = new Map();
    }
    /**
     * 判断该对象是否在游戏中
     * @param obj 对象字符串
     * @returns
     */
    has_object(obj) {
        return this.global_game_map.has(obj);
    }
    /**
     * 用猜测更新该对象的游戏
     * @param obj 对象字符串
     * @param guess 猜测
     * @returns 对比结果，若猜测不合法，则调用结果的is_valid方法为false
     */
    update_object(obj, guess) {
        let tmp = this.global_game_map.get(obj);
        if (typeof (tmp) === 'undefined' || tmp === null)
            return new Result(-1, -1);
        let res = tmp.check(guess);
        this.global_game_map.set(obj, tmp);
        return res;
    }
    /**
     * 开始新游戏
     * @param obj 对象字符串
     * @returns 若obj正在游戏中返回false，否则返回true
     */
    new_object(obj, len) {
        if (this.has_object(obj))
            return false;
        this.global_game_map.set(obj, new Game1A2B(len));
        return true;
    }
    /**
     * 结束游戏
     * @param obj 对象字符串
     * @returns 返回该对象的游戏对象
     */
    remove_object(obj) {
        let res = this.global_game_map.get(obj);
        this.global_game_map.delete(obj);
        return res;
    }
    get_object(obj) {
        return this.global_game_map.get(obj);
    }
}
let controller = new Game1A2BControl();
function start_1A2B(e) {
    let list = e.raw_message.trim().split(/\s+/);
    let obj = get_object_string(e);
    if (list[0].toUpperCase() === '1A2B') {
        if (controller.has_object(obj)) {
            let len = controller.get_object(obj).get_length();
            e.quick_action([Structs.text(`本轮正在进行的${len}位1A2B游戏还未结束，请输入${len}位0～9的数字进行猜测，若要结束本轮游戏请输入“退出1A2B”`)]);
        }
        else if (list.length == 1) {
            if (!controller.new_object(obj, 4)) {
                let len = controller.get_object(obj).get_length();
                e.quick_action([Structs.text(`本轮正在进行的${len}位1A2B游戏还未结束，请输入${len}位0～9的数字进行猜测，若要结束本轮游戏请输入“退出1A2B”`)]);
            }
            else {
                e.quick_action([Structs.text(`4位1A2B游戏开始`)]);
            }
        }
        else {
            let new_len = Number(list[1]);
            if (isNaN(new_len) || new_len < 3 || new_len > 10) {
                e.quick_action([Structs.text('请输入3～10的数字作为位数')]);
            }
            else if (!controller.new_object(obj, new_len)) {
                let len = controller.get_object(obj).get_length();
                e.quick_action([Structs.text(`本轮正在进行的${len}位1A2B游戏还未结束，请输入${len}位0～9的数字进行猜测，若要结束本轮游戏请输入“退出1A2B”`)]);
            }
            else {
                e.quick_action([Structs.text(`${new_len}位1A2B游戏开始`)]);
            }
        }
    }
}
function check_1A2B(e) {
    let obj = get_object_string(e);
    let game1A2B = controller.get_object(obj);
    if (typeof (game1A2B) === 'undefined')
        return;
    let guess = game1A2B.from_string_to_number_array(e.raw_message);
    if (guess === null)
        return;
    let res;
    res = controller.update_object(obj, guess);
    if (!res.is_valid())
        return;
    game1A2B.record.push([e.raw_message, res.to_string()])
    if (res.A === game1A2B.get_length()) {
        e.quick_action([Structs.text(`${game1A2B.get_record_str()}答案正确，共猜测${game1A2B.guess_time}次`)]);
        controller.remove_object(obj);
    }
    else {
        e.quick_action([Structs.text(`${game1A2B.get_record_str()}已猜测${game1A2B.guess_time}次`)]);
    }
}
function quit_1A2B(e) {
    if (e.raw_message.toUpperCase() !== '退出1A2B')
        return;
    let obj = get_object_string(e);
    let game1A2B = controller.remove_object(obj);
    if (typeof (game1A2B) === 'undefined')
        return;
    e.quick_action([Structs.text(`已退出1A2B，上轮游戏共猜测了${game1A2B.guess_time}次，正确答案为：${game1A2B.to_string()}`)]);
}
bot.on("message", e => {
    if (e.message_type === 'group' && e.group_id === 488748631)
        return;
    start_1A2B(e);
    check_1A2B(e);
    quit_1A2B(e);
});
