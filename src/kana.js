// 氏名からカタカナ表記を推測する。問診票（public/intake.html）の guessKana を
// そのまま移したもので、辞書も変換規則も同一。漢字は読みが定まらないので
// 推測しない（空文字を返す）。
//
// 受付一覧で「まだ問診票が出ていない人にも読みがなを出す」ために使う。
// 問診票が届いたら、そちらに書かれたカタカナへ表示を切り替える。

  var NAME_KANA_DICT = {
    // 英語圏
    james:"ジェームズ", john:"ジョン", robert:"ロバート", michael:"マイケル", william:"ウィリアム",
    david:"デイビッド", richard:"リチャード", joseph:"ジョセフ", thomas:"トーマス", charles:"チャールズ",
    christopher:"クリストファー", daniel:"ダニエル", matthew:"マシュー", anthony:"アンソニー", mark:"マーク",
    steven:"スティーブン", stephen:"スティーブン", andrew:"アンドリュー", peter:"ピーター", george:"ジョージ",
    henry:"ヘンリー", jack:"ジャック", harry:"ハリー", jacob:"ジェイコブ", ryan:"ライアン", kevin:"ケビン",
    brian:"ブライアン", eric:"エリック", adam:"アダム", simon:"サイモン", paul:"ポール", oliver:"オリバー",
    liam:"リアム", noah:"ノア", ethan:"イーサン", alexander:"アレクサンダー", nicholas:"ニコラス",
    mary:"メアリー", patricia:"パトリシア", jennifer:"ジェニファー", linda:"リンダ", elizabeth:"エリザベス",
    susan:"スーザン", jessica:"ジェシカ", sarah:"サラ", sara:"サラ", karen:"カレン", nancy:"ナンシー",
    lisa:"リサ", margaret:"マーガレット", sandra:"サンドラ", ashley:"アシュリー", emily:"エミリー",
    michelle:"ミシェル", amanda:"アマンダ", stephanie:"ステファニー", rachel:"レイチェル",
    catherine:"キャサリン", katherine:"キャサリン", kate:"ケイト", anne:"アン", ann:"アン", hannah:"ハンナ",
    grace:"グレース", emma:"エマ", olivia:"オリビア", sophia:"ソフィア", chloe:"クロエ", lucy:"ルーシー",
    alice:"アリス", charlotte:"シャーロット", amelia:"アメリア", isabella:"イザベラ", victoria:"ビクトリア",
    nicole:"ニコール", natalie:"ナタリー", julia:"ジュリア", laura:"ローラ", anna:"アンナ", eva:"エヴァ",
    monica:"モニカ", angela:"アンジェラ", diana:"ダイアナ", christina:"クリスティーナ",
    smith:"スミス", johnson:"ジョンソン", williams:"ウィリアムズ", brown:"ブラウン", jones:"ジョーンズ",
    miller:"ミラー", davis:"デイビス", wilson:"ウィルソン", taylor:"テイラー", white:"ホワイト",
    martin:"マーティン", thompson:"トンプソン", moore:"ムーア", young:"ヤング", walker:"ウォーカー",
    wright:"ライト", green:"グリーン", baker:"ベイカー", scott:"スコット", adams:"アダムズ",
    campbell:"キャンベル", mitchell:"ミッチェル", carter:"カーター", phillips:"フィリップス",
    evans:"エバンス", turner:"ターナー", parker:"パーカー", edwards:"エドワーズ", collins:"コリンズ",
    stewart:"スチュワート", morris:"モリス", murphy:"マーフィー", cook:"クック", rogers:"ロジャース",
    reed:"リード", bailey:"ベイリー", cooper:"クーパー", howard:"ハワード", brooks:"ブルックス",
    gray:"グレイ", watson:"ワトソン", russell:"ラッセル", hughes:"ヒューズ",
    // スペイン語圏・ポルトガル語圏
    maria:"マリア", jose:"ホセ", juan:"フアン", carlos:"カルロス", luis:"ルイス", miguel:"ミゲル",
    pedro:"ペドロ", ana:"アナ", carmen:"カルメン", garcia:"ガルシア", rodriguez:"ロドリゲス",
    martinez:"マルティネス", hernandez:"エルナンデス", lopez:"ロペス", gonzalez:"ゴンサレス",
    perez:"ペレス", sanchez:"サンチェス", ramirez:"ラミレス", torres:"トレス", fernandez:"フェルナンデス",
    diaz:"ディアス", silva:"シルバ", santos:"サントス", oliveira:"オリベイラ", souza:"ソウザ",
    costa:"コスタ", pereira:"ペレイラ", joao:"ジョアン", paulo:"パウロ", lucas:"ルーカス",
    gabriel:"ガブリエル", ferreira:"フェレイラ", almeida:"アルメイダ", reyes:"レイエス", cruz:"クルス",
    ramos:"ラモス", mendoza:"メンドーサ", flores:"フローレス", gomez:"ゴメス", morales:"モラレス",
    bautista:"バウティスタ",
    // フランス語圏・ドイツ語圏
    pierre:"ピエール", jean:"ジャン", marie:"マリー", sophie:"ソフィー", camille:"カミーユ",
    louis:"ルイ", claire:"クレール", francois:"フランソワ", dubois:"デュボワ", bernard:"ベルナール",
    laurent:"ローラン", hans:"ハンス", klaus:"クラウス", muller:"ミュラー", schmidt:"シュミット",
    schneider:"シュナイダー", fischer:"フィッシャー", weber:"ウェーバー", wagner:"ワーグナー",
    becker:"ベッカー", hoffmann:"ホフマン",
    // 中国語圏（ピンイン）
    wang:"ワン", li:"リー", zhang:"ジャン", liu:"リウ", chen:"チェン", yang:"ヤン", zhao:"チャオ",
    huang:"ホアン", wu:"ウー", zhou:"チョウ", xu:"シュー", sun:"スン", ma:"マー", zhu:"チュー",
    hu:"フー", guo:"グオ", lin:"リン", gao:"ガオ", luo:"ルオ", xie:"シエ", tang:"タン",
    feng:"フォン", wei:"ウェイ", jing:"ジン", xin:"シン", mei:"メイ", yu:"ユー", jia:"ジア",
    // 韓国
    kim:"キム", lee:"リー", park:"パク", choi:"チェ", jung:"チョン", jeong:"チョン", kang:"カン",
    cho:"チョ", yoon:"ユン", jang:"チャン", han:"ハン", shin:"シン", seo:"ソ", kwon:"クォン",
    hwang:"ファン", ahn:"アン", song:"ソン", jin:"ジン", min:"ミン",
    // ベトナム
    nguyen:"グエン", tran:"チャン", le:"レ", pham:"ファム", hoang:"ホアン", phan:"ファン",
    vu:"ヴー", dang:"ダン", bui:"ブイ", ho:"ホー", ngo:"ゴー", duong:"ズオン", linh:"リン",
    minh:"ミン", thi:"ティ", van:"ヴァン", anh:"アイン", huong:"フオン", thanh:"タイン", mai:"マイ",
    // 南アジア・中東
    singh:"シン", kumar:"クマール", sharma:"シャルマ", patel:"パテル", gupta:"グプタ", khan:"カーン",
    ali:"アリ", priya:"プリヤ", ravi:"ラヴィ", rahul:"ラフル", amit:"アミット", anita:"アニタ",
    mohammed:"ムハンマド", muhammad:"ムハンマド", mohamed:"モハメド", ahmed:"アフメド", ahmad:"アフマド",
    hassan:"ハサン", hussein:"フセイン", omar:"オマル", fatima:"ファティマ", aisha:"アイシャ",
    yusuf:"ユスフ", ibrahim:"イブラヒム", mustafa:"ムスタファ", abdullah:"アブドゥラ",
    // ロシア語圏
    ivan:"イワン", dmitri:"ドミトリ", sergei:"セルゲイ", olga:"オリガ", natasha:"ナターシャ",
    tatiana:"タチアナ", anastasia:"アナスタシア", vladimir:"ウラジーミル", ivanov:"イワノフ",
    petrov:"ペトロフ", smirnov:"スミルノフ", elena:"エレナ", irina:"イリーナ", svetlana:"スベトラーナ",
    // 東南アジアその他
    siti:"シティ", budi:"ブディ", dewi:"デウィ", putri:"プトリ", sari:"サリ",
  };

  var KANA_PLAIN_V = { a: "ア", i: "イ", u: "ウ", e: "エ", o: "オ" };
  // 特殊母音トークン: [子音と組む段, 後ろに付く音]
  var KANA_SPECIALS = { A: ["e", "イ"], I: ["i", "ー"], O: ["o", "ー"], U: ["u", "ー"], Y: ["a", "イ"] };
  var KANA_TABLE = {
    k: { a: "カ", i: "キ", u: "ク", e: "ケ", o: "コ", def: "ク" },
    g: { a: "ガ", i: "ギ", u: "グ", e: "ゲ", o: "ゴ", def: "グ" },
    s: { a: "サ", i: "シ", u: "ス", e: "セ", o: "ソ", def: "ス" },
    z: { a: "ザ", i: "ジ", u: "ズ", e: "ゼ", o: "ゾ", def: "ズ" },
    j: { a: "ジャ", i: "ジ", u: "ジュ", e: "ジェ", o: "ジョ", def: "ジュ" },
    t: { a: "タ", i: "ティ", u: "トゥ", e: "テ", o: "ト", def: "ト" },
    d: { a: "ダ", i: "ディ", u: "ドゥ", e: "デ", o: "ド", def: "ド" },
    n: { a: "ナ", i: "ニ", u: "ヌ", e: "ネ", o: "ノ", def: "ン" },
    h: { a: "ハ", i: "ヒ", u: "フ", e: "ヘ", o: "ホ", def: "フ" },
    f: { a: "ファ", i: "フィ", u: "フ", e: "フェ", o: "フォ", def: "フ" },
    b: { a: "バ", i: "ビ", u: "ブ", e: "ベ", o: "ボ", def: "ブ" },
    p: { a: "パ", i: "ピ", u: "プ", e: "ペ", o: "ポ", def: "プ" },
    m: { a: "マ", i: "ミ", u: "ム", e: "メ", o: "モ", def: "ム" },
    r: { a: "ラ", i: "リ", u: "ル", e: "レ", o: "ロ", def: "ル" },
    l: { a: "ラ", i: "リ", u: "ル", e: "レ", o: "ロ", def: "ル" },
    w: { a: "ワ", i: "ウィ", u: "ウ", e: "ウェ", o: "ウォ", def: "ウ" },
    v: { a: "ヴァ", i: "ヴィ", u: "ヴ", e: "ヴェ", o: "ヴォ", def: "ヴ" },
    y: { a: "ヤ", i: "イ", u: "ユ", e: "イェ", o: "ヨ", def: "イ" },
    C: { a: "チャ", i: "チ", u: "チュ", e: "チェ", o: "チョ", def: "チ" }, // ch
    S: { a: "シャ", i: "シ", u: "シュ", e: "シェ", o: "ショ", def: "シュ" }, // sh
    Z: { a: "ツァ", i: "ツィ", u: "ツ", e: "ツェ", o: "ツォ", def: "ツ" }, // ts
  };

  function hiraToKata(s) {
    return s.replace(/[ぁ-ゖ]/g, function (c) { return String.fromCharCode(c.charCodeAt(0) + 0x60); });
  }

  function latinToKana(raw) {
    // アクセント記号を除去（José→jose）
    var w = raw.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z]/g, "");
    if (!w) return "";
    w = w
      // 子音の綴りを整理
      .replace(/tch/g, "C").replace(/ch/g, "C").replace(/sh/g, "S")
      .replace(/ts/g, "Z").replace(/th/g, "s").replace(/ph/g, "f")
      .replace(/wh/g, "w").replace(/kh/g, "k")
      .replace(/eigh/g, "A").replace(/igh/g, "Y").replace(/gh$/, "").replace(/gh/g, "g")
      .replace(/ck/g, "k").replace(/x/g, "ks").replace(/qu/g, "ku").replace(/q/g, "k")
      .replace(/c(?=[eiy])/g, "s").replace(/c/g, "k")
      // 語末の -se は濁る（rose→ローズ）＋マジックe（kate→ケイト, mike→マイク）
      .replace(/ase$/, "Az").replace(/ise$/, "Yz").replace(/ose$/, "Oz").replace(/use$/, "Uz").replace(/ese$/, "Iz")
      .replace(/a([bdfgjklmnprstvz])e$/, "A$1").replace(/i([bdfgjklmnprstvz])e$/, "Y$1")
      .replace(/o([bdfgjklmnprstvz])e$/, "O$1").replace(/u([bdfgjklmnprstvz])e$/, "U$1")
      .replace(/e([bdfgjklmnprstvz])e$/, "I$1")
      // 母音の連なり
      .replace(/ee/g, "I").replace(/oo/g, "U").replace(/ou/g, "U")
      .replace(/au|aw/g, "O").replace(/oa/g, "O")
      .replace(/ai|ay/g, "A").replace(/ei|ey/g, "A").replace(/ea/g, "I")
      .replace(/ie$/, "I").replace(/y$/, "I").replace(/y(?![aeiouAIOU])/g, "i")
      // 子音の前・語末の er はアー音（anderson→アンダーソン）
      .replace(/er(?![aeiouAIOUY])/g, "ar");

    var out = "";
    var prevVowel = false;
    for (var i = 0; i < w.length; i++) {
      var c = w.charAt(i);
      var next = w.charAt(i + 1);
      var isVowel = !!(KANA_PLAIN_V[c] || KANA_SPECIALS[c]);
      if (isVowel) {
        if (KANA_SPECIALS[c]) out += KANA_PLAIN_V[KANA_SPECIALS[c][0]] + KANA_SPECIALS[c][1];
        else out += KANA_PLAIN_V[c];
        prevVowel = true;
        continue;
      }
      var nextIsVowel = !!(KANA_PLAIN_V[next] || KANA_SPECIALS[next]);
      if (c === "n" && !nextIsVowel && next !== "y") { out += "ン"; prevVowel = false; continue; }
      if (c === "m" && (next === "b" || next === "p")) { out += "ン"; prevVowel = false; continue; }
      if (next === c) { out += c === "n" ? "ン" : "ッ"; prevVowel = false; continue; }
      if (c === "r" && prevVowel && !nextIsVowel) { out += "ー"; prevVowel = false; continue; }
      var row = KANA_TABLE[c];
      if (!row) { prevVowel = false; continue; }
      // 拗音（ryo→リョ, kyu→キュ など）
      if (next === "y") {
        var v2 = w.charAt(i + 2);
        var base2 = KANA_SPECIALS[v2] ? KANA_SPECIALS[v2][0] : v2;
        var small = { a: "ャ", u: "ュ", o: "ョ", e: "ェ", i: "ィ" }[base2];
        if (small) {
          out += row.i + small + (KANA_SPECIALS[v2] ? KANA_SPECIALS[v2][1] : "");
          i += 2;
          prevVowel = true;
          continue;
        }
      }
      if (nextIsVowel) {
        var base = KANA_SPECIALS[next] ? KANA_SPECIALS[next][0] : next;
        out += row[base] + (KANA_SPECIALS[next] ? KANA_SPECIALS[next][1] : "");
        i++;
        prevVowel = true;
      } else {
        out += row.def;
        prevVowel = false;
      }
    }
    return out;
  }

  function guessKana(name) {
    var tokens = (name || "").trim().split(/[\s　]+/);
    var parts = [];
    for (var i = 0; i < tokens.length; i++) {
      var t = tokens[i].replace(/[.,]/g, "");
      if (!t) continue;
      if (/^[ぁ-ゖー]+$/.test(t)) { parts.push({ kana: hiraToKata(t), latin: false }); continue; }
      if (/^[ァ-ヶー・]+$/.test(t)) { parts.push({ kana: t, latin: false }); continue; }
      if (/^[a-zA-Z'’\-À-ɏ]+$/.test(t)) {
        var subs = t.split(/[-'’]/);
        var kana = "";
        for (var j = 0; j < subs.length; j++) {
          if (!subs[j]) continue;
          var key = subs[j].toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
          kana += NAME_KANA_DICT[key] || latinToKana(subs[j]);
        }
        if (kana) parts.push({ kana: kana, latin: true });
        continue;
      }
      // 漢字などは読みが特定できないので推測しない
      return "";
    }
    if (!parts.length) return "";
    var s = "";
    for (var k = 0; k < parts.length; k++) {
      if (k > 0) s += parts[k].latin && parts[k - 1].latin ? "・" : "　";
      s += parts[k].kana;
    }
    return s;
  }

export { guessKana };
