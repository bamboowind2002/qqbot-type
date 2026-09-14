import { bot } from './bot.js'
import { Structs, CQCodeDecode } from 'node-napcat-ts'

function read_num(expr) {
    let res = { tree: null, expr: null }
    let num = 0
    while (expr.length > 0) {
        if (expr[0] >= '0' && expr[0] <= '9') {
            num = num * 10 + Number(expr[0])
            if (num > 100) {
                return null
            }
            expr = expr.substring(1)
        } else {
            break
        }

    }
    res.tree = {
        type: 'number',
        number: num
    }
    res.expr = expr
    return res
}

function read_F(expr) {
    let res = null
    if (expr.length === 0) return null
    if (expr[0] === '(') {
        expr = expr.substring(1)

        res = read_E(expr)
        if (res === null) return null
        expr = res.expr

        if (expr.length === 0) return null
        if (expr[0] !== ')') return null
        expr = expr.substring(1)

        res.expr = expr
        return res
    } else {
        return read_num(expr)
    }
}

function read_T(expr) {
    let res = null, tmp = null
    res = read_F(expr)
    if (res === null) return null
    expr = res.expr


    while (expr.length > 0) {
        if (expr[0] === '*' || expr[0] === '/') {
            let op = expr[0]
            expr = expr.substring(1)
            tmp = read_F(expr)
            if (tmp === null) return null
            expr = tmp.expr

            res = {
                tree: {
                    type: op,
                    ls: res.tree,
                    rs: tmp.tree
                },
                expr: expr,
            }
        } else {
            break
        }
    }
    return res
}

function read_E(expr) {

    let res = null, tmp = null
    res = read_T(expr)
    if (res === null) return null
    expr = res.expr


    while (expr.length > 0) {
        if (expr[0] === '+' || expr[0] === '-') {
            let op = expr[0]
            expr = expr.substring(1)
            tmp = read_T(expr)
            if (tmp === null) return null
            expr = tmp.expr

            res = {
                tree: {
                    type: op,
                    ls: res.tree,
                    rs: tmp.tree
                },
                expr: expr,
            }
        } else {
            break
        }
    }
    return res

}



/**
 * 解析24点表达式，若为24点表达式返回抽象语法树，否则返回null
 * @param {string} expr 
 */
function get_24_expr(expr) {
    expr = expr.replace(/\s+/g, '')
    let res = read_E(expr)
    if (res === null) {
        return null
    } else if (res.expr.length > 0) {
        return null
    }
    return res.tree
}


function get_number_used(tree) {
    if (tree.type === 'number') {

        return [tree.number]
    }
    return [...get_number_used(tree.ls), ...get_number_used(tree.rs)]
}

function get_tree_value(tree) {
    if (tree.type === 'number') {
        return tree.number
    } else if (tree.type === '+') {
        return get_tree_value(tree.ls) + get_tree_value(tree.rs)
    } else if (tree.type === '-') {
        return get_tree_value(tree.ls) - get_tree_value(tree.rs)
    } else if (tree.type === '*') {
        return get_tree_value(tree.ls) * get_tree_value(tree.rs)
    } else if (tree.type === '/') {
        return get_tree_value(tree.ls) / get_tree_value(tree.rs)
    } else {
        return null
    }
}


function check_valid(tree, nums, sum = 24) {
    let used = get_number_used(tree)
    let num = nums.slice().sort()
    let use = used.slice().sort()
    if (num.length == use.length && num.every((v, i) => v === use[i])) {
        return Math.abs(get_tree_value(tree) - sum) < 0.000001
    } else {
        return false
    }
}

function tree_to_expr(tree) {
    if (tree.type === 'number') {
        return String(tree.number)
    } else if (tree.type === '+') {
        return tree_to_expr(tree.ls) + '+' + tree_to_expr(tree.rs)
    } else if (tree.type === '-') {
        let l = tree_to_expr(tree.ls)
        let r = tree_to_expr(tree.rs)
        if (tree.rs.type === '+' || tree.rs.type === '-') {
            r = "(" + r + ")"
        }
        return l + "-" + r;
    } else if (tree.type === '*') {
        let l = tree_to_expr(tree.ls)
        let r = tree_to_expr(tree.rs)
        if (tree.ls.type === '+' || tree.ls.type === '-') {
            l = "(" + l + ")"
        }
        if (tree.rs.type === '+' || tree.rs.type === '-') {
            r = "(" + r + ")"
        }
        return l + "*" + r;
    } else if (tree.type === '/') {
        let l = tree_to_expr(tree.ls)
        let r = tree_to_expr(tree.rs)
        if (tree.ls.type === '+' || tree.ls.type === '-') {
            l = "(" + l + ")"
        }
        if (tree.rs.type === '+' || tree.rs.type === '-' || tree.rs.type === '*' || tree.rs.type === '/') {
            r = "(" + r + ")"
        }
        return l + "/" + r;
    }
}




function get_all_answer(nums, sum = 24) {
    let ans = []

    function dfs_get(arr) {
        if (arr.length == 1) {
            if (Math.abs(get_tree_value(arr[0]) - sum) < 0.000001) {
                ans.push(arr[0])
            }
            return
        }
        for (let i = 0; i < arr.length; i++) {
            for (let j = 0; j < arr.length; j++) {
                if (i == j) continue;
                let tmp = []

                for (let k = 0; k < arr.length; k++) {
                    if (k == i || k == j) continue
                    tmp.push(arr[k])
                }

                for (let e of ['+', '-', '*', '/']) {
                    let elem = { type: e, ls: arr[i], rs: arr[j] }
                    if (get_tree_value(elem) < -0.000001) continue
                    tmp.push(elem)
                    dfs_get(tmp)
                    tmp.pop()
                }
            }
        }
    }

    let arr = []
    for (let e of nums) {
        arr.push({ type: "number", number: e })
    }
    dfs_get(arr)
    return ans
}


function get_4_random_number(max_value = 13) {
    let res = []
    for (let i = 0; i < 4; i++) {
        res.push(Math.floor(Math.random() * max_value) + 1)
    }
    return res
}

function compare_flat_tree_arr_elem(a, b) {
    if (a.sign < b.sign) {
        return -1
    } else if (a.sign > b.sign) {
        return 1
    } else {
        return compare_flat_tree(a.val, b.val)
    }
}

function compare_flat_tree_arr(a, b) {
    let n = Math.min(a.length, b.length)
    for (let i = 0; i < n; i++) {
        let tmp = compare_flat_tree_arr_elem(a[i], b[i])
        if (tmp !== 0) {
            return tmp
        }
    }
    return a.length - b.length
}

function compare_flat_tree(a, b) {
    if (a.type === '+-' && b.type === '+-') {
        return compare_flat_tree_arr(a.arr, b.arr)
    }
    if (a.type === '+-') {
        return -1
    }
    if (b.type === '+-') {
        return 1
    }

    if (a.type === '*/' && b.type === '*/') {
        return compare_flat_tree_arr(a.arr, b.arr)
    }
    if (a.type === '*/') {
        return -1
    }
    if (b.type === '*/') {
        return 1
    }

    if (a.type === 'number' && b.type === 'number') {
        return a.number - b.number
    }
    if (a.type === 'number') {
        return -1
    }
    return 1
}

function to_flat_tree(tree) {
    if (tree.type === 'number') {
        return { type: 'number', number: tree.number }
    }
    let flat_ls = to_flat_tree(tree.ls)
    let flat_rs = to_flat_tree(tree.rs)
    let res = {}
    if (tree.type === '+' || tree.type === '-') {
        res.type = '+-'

        res.arr = []
        if (flat_ls.type === 'number' || flat_ls.type === '*/') {
            res.arr.push({ sign: '+', val: flat_ls })
        } else {
            for (let e of flat_ls.arr) {
                res.arr.push(e)
            }
        }

        if (flat_rs.type === 'number' || flat_rs.type === '*/') {
            res.arr.push({ sign: tree.type, val: flat_rs })
        } else {
            for (let e of flat_rs.arr) {
                if (tree.type === '+') {
                    res.arr.push(e)
                } else {
                    if (e.sign == '+') {
                        e.sign = '-'
                    } else {
                        e.sign = '+'
                    }
                    res.arr.push(e)
                }
            }
        }


    } else {
        res.type = '*/'
        res.arr = []
        if (flat_ls.type === 'number' || flat_ls.type === '+-') {
            res.arr.push({ sign: '*', val: flat_ls })
        } else {
            for (let e of flat_ls.arr) {
                res.arr.push(e)
            }
        }


        if (flat_rs.type === 'number' || flat_rs.type === '+-') {
            res.arr.push({ sign: tree.type, val: flat_rs })
        } else {
            for (let e of flat_rs.arr) {
                if (tree.type === '*') {
                    res.arr.push(e)
                } else {
                    if (e.sign == '*') {
                        e.sign = '/'
                    } else {
                        e.sign = '*'
                    }
                    res.arr.push(e)
                }
            }
        }
    }
    res.arr.sort((a, b) => {
        return compare_flat_tree_arr_elem(a, b)
    })
    return res
}

function flat_tree_to_expr(tree) {
    if (tree.type === 'number') {
        return String(tree.number)
    }
    let res = ''
    if (tree.type === '+-') {
        if (tree.arr[0].sign === '-') {
            res += '-'
        }
        res += flat_tree_to_expr(tree.arr[0].val)
        for (let i = 1; i < tree.arr.length; i++) {
            res += tree.arr[i].sign
            res += flat_tree_to_expr(tree.arr[i].val)
        }
    } else {
        if (tree.arr[0].sign === '/') {
            if (tree.arr[0].val.type === 'number') {
                res += flat_tree_to_expr(tree.arr[0].val) + "^(-1)"
            } else {
                res += "(" + flat_tree_to_expr(tree.arr[0].val) + ")^(-1)"
            }
        } else {
            if (tree.arr[0].val.type === 'number' || tree.arr.length === 1) {
                res += flat_tree_to_expr(tree.arr[0].val)
            } else {
                res += "(" + flat_tree_to_expr(tree.arr[0].val) + ")"
            }
        }
        for (let i = 1; i < tree.arr.length; i++) {
            res += tree.arr[i].sign
            if (tree.arr[i].val.type === 'number') {
                res += flat_tree_to_expr(tree.arr[i].val)
            } else {
                res += "(" + flat_tree_to_expr(tree.arr[i].val) + ")"
            }
        }
    }
    return res
}
// let a = get_24_expr('12-7+3+4')
// let b = to_flat_tree(a)
// let c = flat_tree_to_expr(b)

// console.dir(a, {depth:null})
// console.dir(b, {depth:null})
// console.log(c)
class Point24 {
    constructor(sum = 24) {
        this.arr = []
        this.sum = sum
        do {
            this.arr = get_4_random_number(sum / 2 + 1)
        } while (get_all_answer(this.arr, this.sum).length === 0)
    }
}

let game_map = new Map()

/**
 * 获取类型合并id的字符串
 * @param msg 消息
 * @returns 可作为key的字符串
 */
function get_object_string(msg) {
    let id;
    if (msg.message_type === 'group')
        id = msg.group_id;
    else if (msg.message_type === 'discuss')
        id = msg.discuss_id;
    else
        id = msg.from_id;
    return `${msg.message_type}_${id}`;
}


bot.on("message", e => {
    let cmd = e.raw_message.trim()
    let obj = get_object_string(e)

    if (/^([1-9]\d*)点$/.test(cmd)) {
        let sum = Number(/^([1-9]\d*)点$/.exec(cmd)[1])

        if (game_map.has(obj)) {
            let arr = game_map.get(obj).arr
            let sum = game_map.get(obj).sum
            e.quick_action([Structs.text(`本轮${sum}点游戏尚未结束，题目为：\n${arr[0]} ${arr[1]} ${arr[2]} ${arr[3]}\n如需结束游戏，发送「退出${sum}点」结束游戏，并给出本轮游戏可能的答案`)])
        } else {
            if (sum > 100) {
                e.quick_action([
                    Structs.text('仅支持1-100点游戏')
                ])
            } else {
                game_map.set(obj, new Point24(sum))
                let arr = game_map.get(obj).arr
                e.quick_action([Structs.text(`请计算下面4个数的${sum}点：\n${arr[0]} ${arr[1]} ${arr[2]} ${arr[3]}\n如需结束游戏，发送「退出${sum}点」结束游戏，并给出本轮可能的答案`)])
            }

        }
    } else if (/^退出([1-9]\d*)点$/.test(cmd)) {
        if (game_map.has(obj)) {
            let arr = game_map.get(obj).arr
            let sum = game_map.get(obj).sum

            let ans = get_all_answer(arr, sum)
            for (let i in ans) {
                ans[i] = flat_tree_to_expr(to_flat_tree(ans[i]))
            }
            ans = ans.sort()
            ans = Array.from(new Set(ans))
            let str = `对于${arr[0]} ${arr[1]} ${arr[2]} ${arr[3]}的${sum}点，可能的答案有：\n`
            for (let i in ans) {
                str += ans[i]
                if (Number(i) + 1 < ans.length) {
                    str += '\n'
                }
            }
            e.quick_action([Structs.text(str)])
            game_map.delete(obj)
        }
    } else {
        if (!game_map.has(obj)) {
            return;
        }

        let arr = game_map.get(obj).arr
        let sum = game_map.get(obj).sum
        let tree = get_24_expr(CQCodeDecode(e.raw_message))
        if (tree === null) {
            return;
        }
        if (!check_valid(tree, arr, sum)) {
            e.quick_action([Structs.text(`表达式结果不是${sum}或者使用的数字不合法`)])
        } else {
            // console.log(e)
            let arr = game_map.get(obj).arr
            let sum = game_map.get(obj).sum
            let res = [
                Structs.at(e.sender.user_id),
                Structs.text(`\n${tree_to_expr(tree)}=${sum}，恭喜你答案正确\n`)
            ]


            
            let ans = get_all_answer(arr, sum)
            for (let i in ans) {
                ans[i] = flat_tree_to_expr(to_flat_tree(ans[i]))
            }
            ans = ans.sort()
            ans = Array.from(new Set(ans))
            let str = `对于${arr[0]} ${arr[1]} ${arr[2]} ${arr[3]}的${sum}点，可能的答案有：\n`
            for (let i in ans) {
                str += ans[i]
                if (Number(i) + 1 < ans.length) {
                    str += '\n'
                }
            }
            res.push(Structs.text(str))
            e.quick_action(res)
            game_map.delete(obj)
        }
    }



})

