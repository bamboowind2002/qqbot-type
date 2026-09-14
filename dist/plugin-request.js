import { bot } from './bot.js'
// 同意好友申请
bot.on("request.friend", e => e.quick_action());
// // 同意群邀请
// bot.on("request.group.invite", e => e.quick_action());
// 同意加群申请，拒绝`e.approve(false)`
bot.on("request.group.add", e => e.quick_action());

