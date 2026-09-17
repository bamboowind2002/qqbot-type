import fs from "fs";
import path from "path";

// 当前脚本目录
const __dirname = path.resolve();
const pwd = path.dirname(new URL(import.meta.url).pathname);

// 读取文件并解析 JSON
function readJSON(fileName) {
  const data = fs.readFileSync(path.join(pwd, fileName), "utf-8");
  return JSON.parse(data);
}

const zongCiPin = readJSON("zongCiPin.json");
const validChar = new Set(readJSON("validChar.json").k);
const pre = new Set(readJSON("pre.json").k);

// 字母与数字
const letterDigit = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";

export function analyze_rank(s) {
  let score = 0;
  let err = false;
  let hard = null;
  let water = null;

  try {
    s = s.trim();
    let ns = "";

    for (let pos = 0; pos < s.length; pos++) {
      const c = s[pos];
      if (!validChar.has(c)) {
        if (
          c === " " &&
          pos !== 0 &&
          pos !== s.length - 1 &&
          letterDigit.includes(s[pos - 1]) &&
          letterDigit.includes(s[pos + 1])
        ) {
          ns += c;
        } else if (
          ":,.;!'\"".includes(c) &&
          ((pos !== 0 && letterDigit.includes(s[pos - 1])) ||
            (pos !== s.length - 1 && letterDigit.includes(s[pos + 1])))
        ) {
          ns += c;
        }
        continue;
      }
      ns += c;
    }

    s = ns;
    if (s.length === 0) {
      return { score: -1, rankEn: null, rank: null, error: null, hard: null, water: null, waterDelta: null };
    }

    const dp = Array(s.length + 1).fill([-1, -1, -1]);
    dp[0] = [0, 0, -1];

    for (let pos = 0; pos < s.length; pos++) {
      let curLen = 1;
      while (pos + curLen <= s.length) {
        const w = s.slice(pos, pos + curLen);
        if (curLen === 1 || w in zongCiPin) {
          const wl = w in zongCiPin ? zongCiPin[w].at(-1) : 1;
          const newPos = pos + curLen;
          if (newPos > s.length) break;
          const tar = dp[newPos];
          const newCodeLen = dp[pos][0] + wl;
          const newWordCnt = dp[pos][1] + 1;
          if (
            tar[0] === -1 ||
            tar[0] > newCodeLen ||
            (tar[0] === newCodeLen && tar[1] > newWordCnt)
          ) {
            dp[newPos] = [newCodeLen, newWordCnt, pos];
          }
        }
        if (pre.has(s.slice(pos, pos + curLen))) {
          curLen++;
        } else {
          break;
        }
      }
    }

    let curPos = s.length;
    water = 1;
    hard = 0;

    while (curPos !== 0) {
      const [_, __, prePos] = dp[curPos];
      const w = s.slice(prePos, curPos);
      if (zongCiPin[w]) {
        if (w.length === 1) {
          hard += Math.min(10, Math.pow(zongCiPin[w][0], 1.5) / 100000);
        } else {
          water += 2000 / (zongCiPin[w][0] + 2000);
        }
      }
      curPos = prePos;
    }

    score = Math.round((hard / water) * 100) / 100;
  } catch (e) {
    err = true;
  }

  let rk_en = "";
  let rk_zh = "";

  if (score < 0.1) {
    rk_en = "miao";
    rk_zh = "淼";
  } else if (score < 0.3) {
    rk_en = "shui";
    rk_zh = "水";
  } else if (score < 0.8) {
    rk_en = "yi";
    rk_zh = "易";
  } else if (score < 5) {
    rk_en = "pu";
    rk_zh = "普";
  } else if (score < 15) {
    rk_en = "nan";
    rk_zh = "难";
  } else {
    rk_en = "nue";
    rk_zh = "虐";
  }

  if (score > 100) rk_zh = "爆表";

  return {
    score, rankEn: rk_en, rank: rk_zh, error: err,
    hard: err ? null : hard,
    water: err ? null : water,
    waterDelta: err ? null : water - 1
  };
}

export function get_rank(s) {
  const result = analyze_rank(s);
  return [result.score, result.rankEn, result.rank, result.error];
}

// console.log(get_rank("满面泪流"))
