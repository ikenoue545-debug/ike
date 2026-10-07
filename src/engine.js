(function(root){
'use strict';
const SOURCES=[
 {id:'tags',name:'freee公式｜取引先・品目・部門・メモタグと備考',url:'https://support.freee.co.jp/hc/ja/articles/202847730',note:'タグは取引の分類・補足。借貸別の情報を区別し、証憑・用途・負担者と照合します。空欄を推測で埋めません。'},
 {id:'monthly',name:'freee公式｜月次推移（PL・BS）の確認とCSV出力',url:'https://support.freee.co.jp/hc/ja/articles/203293920',note:'科目ごとの推移を参照。円単位、分類と科目を同じ列、科目内訳を閉じ、レポート集計完了後に出力すると照合しやすくなります。'},
 {id:'receivable',name:'freee公式｜入金管理レポート・債権一覧',url:'https://support.freee.co.jp/hc/ja/articles/203293810',note:'決済残額・期日・消込を照合。未決済の帳簿表示と実際の未回収は別に確認します。'},
 {id:'labor',name:'厚生労働省｜労働保険の年度更新',url:'https://www.mhlw.go.jp/bunya/roudoukijun/roudouhoken01/kousin.html',note:'概算保険料と確定保険料の精算を確認。月次のマイナスだけで処理誤りと断定しません。'},
 {id:'sheet',name:'記帳チェックシート Ver2021.4（添付資料）',url:'',note:'内部手順の参照。手続番号の重複は項目名で区別。数値基準は抽出の目安で、税務の結論ではありません。'},
 {id:'freee',name:'freee公式｜仕訳帳CSVの仕様・出力方法',url:'https://support.freee.co.jp/hc/ja/articles/204615564',note:'新旧CSVの取引日・借方／貸方科目・金額・取引先・仕訳番号を確認。UTF-8とShift_JISに対応。'},
 {id:'expense',name:'国税庁 No.2210｜必要経費の知識',url:'https://www.nta.go.jp/taxes/shiraberu/taxanswer/shotoku/2210.htm',note:'個人の所得税・住民税や家事費などは必要経費に算入されません。摘要から候補を拾い、本人分かを確認します。'},
 {id:'social',name:'国税庁 No.1130｜社会保険料控除',url:'https://www.nta.go.jp/taxes/shiraberu/taxanswer/shotoku/1130.htm',note:'国民年金・国民健康保険などの本人負担分は所得控除の確認対象。事業の雇用者負担と区別します。'},
 {id:'mutual',name:'国税庁 No.1135｜小規模企業共済等掛金控除',url:'https://www.nta.go.jp/taxes/shiraberu/taxanswer/shotoku/1135.htm',note:'掛金の所得控除について確認。中小企業倒産防止共済と混同しないようにします。'},
 {id:'repairP',name:'国税庁 No.1379｜修繕費の判定（個人）',url:'https://www.nta.go.jp/taxes/shiraberu/taxanswer/shotoku/1379.htm',note:'原状回復か、価値・使用可能期間の増加かを実質で判断。20万円以上というだけでは資産計上を断定しません。'},
 {id:'repairC',name:'国税庁 No.5402｜修繕費の判定（法人）',url:'https://www.nta.go.jp/taxes/shiraberu/taxanswer/hojin/5402.htm',note:'修繕費と資本的支出の判定基準。名称・金額だけで結論を出しません。'},
 {id:'asset',name:'国税庁 No.2100｜減価償却のあらまし',url:'https://www.nta.go.jp/taxes/shiraberu/taxanswer/shotoku/2100.htm',note:'取得価額・使用開始・適用要件を確認。少額資産の特例はこのアプリで自動判定しません。'},
 {id:'smallasset',name:'国税庁 No.5408｜中小企業者等の少額減価償却資産の特例',url:'https://www.nta.go.jp/taxes/shiraberu/taxanswer/hojin/5408.htm',note:'令和8年度改正で、2026年4月1日以後に取得した資産は40万円未満（年300万円まで）。それより前の取得は30万円未満。'},
 {id:'smalldep',name:'国税庁 No.5403｜少額の減価償却資産になるかどうかの判定',url:'https://www.nta.go.jp/taxes/shiraberu/taxanswer/hojin/5403.htm',note:'10万円未満・使用期間1年未満は即時に費用。金額は「通常1単位として取引される単位」（1組）ごとに判定します。'},
 {id:'entertain',name:'国税庁 No.5265｜交際費等の範囲と損金不算入額の計算',url:'https://www.nta.go.jp/taxes/shiraberu/taxanswer/hojin/5265.htm',note:'2024年4月1日以後、1人あたり1万円以下の飲食費は書類の保存を条件に交際費等から除外。社内飲食は除外の対象外です。'},
 {id:'invoice',name:'国税庁｜インボイス制度の見直し（令和8年度改正）',url:'https://www.nta.go.jp/taxes/shiraberu/zeimokubetsu/shohi/keigenzeiritsu/invoice-review/index.htm',note:'インボイスのない仕入の控除割合：2026/10/1〜2028/9/30は70%、その後50%・30%と段階的に縮小。'},
 {id:'invoicesite',name:'国税庁｜適格請求書発行事業者公表サイト',url:'https://www.invoice-kohyo.nta.go.jp/',note:'相手の登録番号・登録日・取消日を確認します。'},
 {id:'withhold',name:'国税庁 No.2795｜源泉徴収が必要な報酬・料金等とは',url:'https://www.nta.go.jp/taxes/shiraberu/taxanswer/gensen/2795.htm',note:'個人への士業報酬・原稿料等は100万円以下10.21%、超える部分20.42%。司法書士等は（支払額−1万円）×10.21%。'},
 {id:'withholdTax',name:'国税庁 No.2792｜源泉徴収が必要な報酬・料金等とは（消費税の扱い）',url:'https://www.nta.go.jp/taxes/shiraberu/taxanswer/gensen/2792.htm',note:'請求書で消費税が区分されていれば、税抜の報酬額を源泉徴収の対象にできます。'},
 {id:'paydue',name:'国税庁 No.2505｜源泉所得税の納付期限と納期の特例',url:'https://www.nta.go.jp/taxes/shiraberu/taxanswer/gensen/2505.htm',note:'原則は支払月の翌月10日。納期の特例は1〜6月分を7月10日、7〜12月分を翌年1月20日。'},
 {id:'directorpay',name:'国税庁 No.5211｜役員に対する給与',url:'https://www.nta.go.jp/taxes/shiraberu/taxanswer/hojin/5211.htm',note:'定期同額給与・事前確定届出給与・業績連動給与以外は損金不算入。改定は原則として期首から3か月以内。'},
 {id:'nondeduct',name:'国税庁 No.5300｜損金の額に算入される租税公課等',url:'https://www.nta.go.jp/taxes/shiraberu/taxanswer/hojin/5300.htm',note:'法人税・住民税の本税、加算税・延滞税、罰金等は損金不算入。'},
 {id:'interestTax',name:'東京都主税局｜利子割（法人は2016年から対象外）',url:'https://www.tax.metro.tokyo.lg.jp/kazei/life/risi',note:'法人が受け取る預金利息から差し引かれるのは所得税・復興特別所得税15.315%のみ。'},
 {id:'jicpa240',name:'日本公認会計士協会｜監査基準報告書240（不正）',url:'https://jicpa.or.jp/specialized_field/2-24-240-2-20230810.pdf',note:'期末近く・手入力・キリのいい金額・普段使わない科目の組み合わせなど、仕訳テストで優先する特徴の参考。'}
];
const CHECKS=[
 {key:'context',code:'追加：内容',title:'科目と取引情報の組み合わせ',group:'経費',needs:'品目・メモ・摘要を含む仕訳帳CSVと元資料',method:'借貸を区別した品目・摘要・メモと科目を照合。飲食の用途、家具利用料、私用・共用・確認待ちの記載から確認候補をまとめます。法人の会議費は1人1万円の基準で人数を確認します。タグだけで正誤を確定しません。',dataset:'current'},
 {key:'monthly',code:'追加：月次',title:'月次PL・BSの推移と仕訳照合',group:'推移',needs:'月次PL・BSのCSV・全件仕訳帳',method:'各科目の負数・前月変動を抽出。PLは単月金額、BSは各月末残高を参照。条件をそろえて仕訳と照合します。',dataset:'monthlyPL'},
 {key:'sync',code:'F-1',title:'データ連携のエラー',group:'事前確認',needs:'ホーム画面・各口座の最終同期日',method:'同期エラーと対象期間の明細が欠けていないかを確認。仕訳CSVだけでは同期状況は分かりません。',mode:'manual'},
 {key:'unreg',code:'F-2',title:'未登録取引',group:'事前確認',needs:'未登録明細CSV',method:'高額な明細と長期の未登録を抽出。多数の場合は登録せず、記帳の依頼事項にまとめます。',dataset:'unregistered'},
 {key:'duplicate',code:'F-3',title:'重複計上の候補',group:'事前確認',needs:'対象期間の仕訳帳CSV',method:'日付・借貸科目・金額・取引先・摘要が同じ別仕訳を照合。7日以内に支払方法を変えて同額を2回計上した候補も照合します。定例取引の可能性があるため証憑で確認します。',dataset:'current'},
 {key:'rules',code:'F-4',title:'自動登録ルールの候補',group:'事前確認',needs:'仕訳帳CSV・既存ルール画面',method:'同じ相手に同じ科目で反復する支出から候補を作成。既存ルールとの重複・取引内容の変動は人が確認します。',dataset:'current'},
 {key:'cash',code:'GA-1',title:'現金・預金の残高',group:'残高',needs:'月末残高一覧・通帳／出納帳残高',method:'明細の増減から期末残高を推定しません。入力した帳簿残高と資料残高の差額を確認します。',dataset:'balances'},
 {key:'loan',code:'HB1-1',title:'借入金・リース債務',group:'残高',needs:'月末残高一覧・契約別返済予定表',method:'契約別残高を返済予定表と照合。元金の減少額が同額とは限らないため、予定表を基準にします。',dataset:'balances'},
 {key:'asset',code:'GD-1',title:'高額消耗品・修繕費',group:'経費',needs:'仕訳帳CSV・請求書',method:'チェックシートの目安である消耗品10万円・修繕費20万円以上の明細を抽出。金額帯（10万・20万・40万円。2026年3月31日までの取得は30万円）と修繕費の形式基準（60万円・取得価額の10%）で理由を説明し、同時期のまとめ買いや別の費用科目に入った機器も候補にします。1組・1工事の範囲と適用要件を確認します。',dataset:'current'},
 {key:'assetbook',code:'GD-1',title:'固定資産台帳と帳簿',group:'残高',needs:'固定資産台帳・科目別帳簿残高',method:'同じ基準日の台帳簿価と帳簿残高を照合。取得・除売却・償却の内訳を確認します。',mode:'manual'},
 {key:'prepaid',code:'番号なし',title:'長期前払費用・TKC登録',group:'残高',needs:'固定資産台帳・契約書・TKC画面',method:'償却・費用科目・二重管理を確認。台帳の照合とTKC登録の実施確認は資料を見て記録します。',mode:'manual'},
 {key:'rent',code:'JC1-1',title:'家賃の計上と新規契約',group:'経費',needs:'仕訳帳CSV・契約書',method:'取引先別に月額の変化を確認。対象期間を完全に含む場合だけ欠落月を抽出。初期費用は契約書で確認します。',dataset:'current'},
 {key:'salary',code:'HD-1',title:'給与・役員報酬・法定福利費',group:'給与',needs:'仕訳帳CSV・給与台帳・納付資料',method:'給与科目の月次変動を抽出。法人の役員報酬は月額が変わった月を抽出します（定期同額給与）。社会保険を固定の割合で正誤判定せず、支給額・会社負担・支払時期を照合します。',dataset:'current'},
 {key:'paytax',code:'HD-2',title:'給与の源泉税・住民税',group:'給与',needs:'給与台帳・預り金元帳・納付資料',method:'控除した額と納付した額を税目別に照合。預り金を7か月以上減らしていない場合は候補にします。預り金残高があるだけでは未納を断定しません。',mode:'manual'},
 {key:'outsourcetax',code:'JC2-1 / 2',title:'外注報酬の源泉徴収',group:'給与',needs:'外注・報酬の仕訳と請求書・納付資料',method:'士業・原稿料・デザイン料などの報酬で、同じ仕訳に預り金がないもの、源泉税額が10.21%／20.42%と合わないものを抽出。個人への報酬か、対象の業務か、支払者の義務と納期を確認。取引先名から個人／法人は断定できません。',mode:'manual'},
 {key:'tps',code:'番号なし',title:'TPS9100・給与システム登録',group:'給与',needs:'給与システムの登録画面',method:'システムへの転記済みを確認。会計CSVから登録済みかは判定できません。',mode:'manual'},
 {key:'director',code:'HB2-1',title:'役員・株主との貸借',group:'残高',needs:'相手別月末残高一覧',method:'法人の役員貸付金・借入金のマイナスや両建てを確認。別人の残高を自動相殺しません。',dataset:'balances',corp:true},
 {key:'sales',code:'JA-1',title:'売上の月次推移',group:'推移',needs:'仕訳帳CSV・売上資料',method:'取引先別の急増減・継続売上の欠落を抽出。季節性や未登録分の影響を売上資料で確認します。',dataset:'current'},
 {key:'ar',code:'GA-1',title:'売掛金の未回収・未消込',group:'残高',needs:'債権債務の期日一覧・入金記録',method:'対象末日時点で期日を過ぎた未決済を抽出。銀行入金があるかを確認して未回収と未消込を分けます。',dataset:'aging'},
 {key:'cost',code:'JB-1',title:'仕入・外注費の推移',group:'推移',needs:'仕訳帳CSV・仕入資料',method:'月別変動と売上との関係を確認。原価率は棚卸・期ずれの影響があるため結論にしません。',dataset:'current'},
 {key:'ap',code:'HA-1',title:'買掛金・未払金・未払費用',group:'残高',needs:'債権債務の期日一覧・支払記録',method:'期日を過ぎた残高を抽出し、支払済みの未消込と実際の未払いを区別します。',dataset:'aging'},
 {key:'stock',code:'GC-1',title:'棚卸資産・月末在庫',group:'残高',needs:'棚卸表・帳簿残高',method:'実際の在庫と月末残高を照合。仕訳がないことから在庫ゼロとは判断せず、棚卸方針を確認します。',mode:'manual'},
 {key:'other',code:'JC3-1',title:'その他経費の異常',group:'推移',needs:'仕訳帳CSV',method:'月次変動・高額・新出の科目と、めったに使われない科目の組み合わせを候補にします。返金・訂正・季節性は元資料で確認します。',dataset:'current'},
 {key:'evidence',code:'JC3-2',title:'科目・証憑の確認',group:'経費',needs:'仕訳帳CSV・請求書等',method:'高額支出と摘要が空の取引、期末近くに手入力されたキリのいい金額の仕訳を抽出。CSVに証憑が出ていないことを、証憑未保存とは判定しません。',dataset:'current'},
 {key:'card',code:'JC3-3',title:'カードの消込',group:'残高',needs:'カード月末残高・引落記録',method:'残高の増加をきっかけに明細と消込を確認。締日・分割払い・利用増を踏まえます。',dataset:'balances'},
 {key:'personal',code:'JC3-4',title:'個人事業主の私的支出',group:'経費',needs:'仕訳帳CSV・本人分の資料',method:'所得税・住民税・国民年金・国保・小規模企業共済等の摘要と、事業の収入に入った預金利息を検出。本人負担と従業員分を区別します。',dataset:'current',individual:true},
 {key:'temp',code:'JC3-4 / JE-2',title:'未確定損益・仮払金・仮受金',group:'残高',needs:'仕訳帳CSV・月末残高',method:'暫定科目の残高と内容不明の明細を一覧化。精算期限が先の正常な仮払金もあるためゼロを強制しません。',dataset:'balances'},
 {key:'misc',code:'JE-1',title:'雑収入・雑損失の内容',group:'経費',needs:'仕訳帳CSV・内訳資料',method:'内容が説明できるかを取引ごとに確認。雑収入・雑損失であることだけでは誤りではありません。',dataset:'current'},
 {key:'taxes',code:'HC-1 / 2',title:'未払税金・予定納税',group:'税金',needs:'申告書・納付資料・月末残高',method:'決算期・納期限・振替日・延長等を確認して照合。経費科目に入った延滞税・加算税・罰金・法人税等・源泉所得税は自動で抽出します。期首2か月後に必ずゼロになるとは判定しません。',mode:'manual'},
 {key:'vat',code:'HC-3',title:'消費税の税区分',group:'税金',needs:'仕訳帳CSV（「消費税区分」画面）・消費税区分別表・対象元帳',method:'インボイスのない仕入の控除割合（控80・控70など）と取引日の期間をここで自動照合します（2026年10月1日から7割）。科目×税区分の違和感と取引ごとの判断は、同じアプリの「消費税区分」画面で行い、進み具合をここに表示します。',mode:'manual'},
 {key:'interest',code:'HC-4',title:'法人の利息・配当と源泉税',group:'税金',needs:'入金資料・仕訳帳CSV',method:'受取利息・配当の明細を抽出し、同じ仕訳に記録された源泉所得税が15.315%と合うか照合します。入金額だけで税率や控除税額を逆算せず、支払通知と照合します。',dataset:'current',corp:true},
 {key:'continuity',code:'追加：履歴',title:'過去仕訳との継続性',group:'履歴',needs:'同一顧客の過去仕訳帳・当期仕訳帳・当期資料',method:'取引先と摘要が似た過去の仕訳を照合。科目・税区分の違いと過去処理の分岐を候補化し、「いつも」と「今回」を並べて、どこがどう違うかを説明します。過去が正しいことや同一用途は自動確定しません。',dataset:'current'}
];
const TYPES={
 current:{name:'当期の仕訳帳',desc:'freee汎用仕訳CSV（新／旧）。取引先・品目・部門・メモを借貸別に読込し、元の全列も保持します。',fields:{date:['取引日','日付','仕訳日'],id:['仕訳番号','伝票番号','取引番号','No.','No','番号'],exportNo:['No.','No'],debit:['借方勘定科目','借方科目'],debitAmount:['借方金額'],credit:['貸方勘定科目','貸方科目'],creditAmount:['貸方金額'],party:['取引先','取引先名'],debitParty:['借方取引先名','借方取引先'],creditParty:['貸方取引先名','貸方取引先'],description:['摘要','取引内容','備考'],debitTax:['借方税区分'],creditTax:['貸方税区分']},required:['date','debit','debitAmount','credit','creditAmount']},
 prior:{name:'前期・過去の仕訳帳（複数年）',desc:'同じ顧客の複数年CSVを蓄積。取引先・摘要・用途メモと品目・部門から過去の科目と税区分を照合。対象開始月より前の仕訳だけ参照します。'},
 unregistered:{name:'未登録明細',desc:'取引日・摘要・金額1列の明細。入金／出金が別列ならテンプレートの金額列に統合してください。',fields:{date:['取引日','日付','明細日'],description:['摘要','取引内容','備考','内容'],party:['取引先','取引先名'],amount:['金額','出金額','支出金額','支払金額','入金額','収入金額']},required:['date','amount']},
 balances:{name:'月末残高一覧',desc:'月・科目・残高の縦形式。資料残高を追加すると差額を照合します。',fields:{date:['月','年月','日付','基準日'],account:['勘定科目','科目','口座'],party:['取引先','契約','品目'],balance:['帳簿残高','残高','月末残高'],expected:['資料残高','実際残高','予定残高']},required:['date','account','balance']},
 aging:{name:'債権債務・期日一覧',desc:'科目・取引先・期日・決済残額。売掛金は月次PL・BS画面で基準日と全件の範囲を確認します。',fields:{date:['発生日','取引日','日付'],account:['勘定科目','科目'],party:['取引先','取引先名'],due:['期日','入金予定日','支払予定日','決済期日','回収期日'],amount:['未決済額','決済残額','未決済残額','残高','未決済金額','金額'],asOf:['基準日','残高基準日','確認基準日'],invoice:['請求書番号','管理番号','取引番号']},required:['account','due','amount']},
 monthlyPL:{name:'月次PL（単月）',desc:'freee月次推移の損益計算書CSV（円単位・分類と勘定科目は同じ列）。「表示するタグ」は なし・取引先・品目・部門 のどれでも読めます。タグ別の内訳は科目合計とは別に保存し、二重に数えません。年付き月の横形式、月・科目・金額の縦形式に対応。期間累計は月別とは別に保存・照合します。',fields:{account:['勘定科目','科目','勘定科目名','科目名','分類・勘定科目','分類と勘定科目'],accountCode:['勘定科目コード','科目コード'],reportedTotal:['期間累計','期間合計'],date:['月','年月','対象月'],amount:['金額','月次金額','残高'],category:['分類','分類名','区分'],party:['取引先','取引先名']},required:['account']},
 monthlyBS:{name:'月次BS（月末残高）',desc:'freee月次推移の貸借対照表CSV（円単位・分類と勘定科目は同じ列）。「表示するタグ」は なし・取引先・品目・部門 のどれでも読めます。タグ別に出力したCSVは、科目合計とタグ別の内訳を分けて保存し、取引先別・品目別・部門別を並べて持てます。',fields:{account:['勘定科目','科目','勘定科目名','科目名','分類・勘定科目','分類と勘定科目'],accountCode:['勘定科目コード','科目コード'],opening:['期首','期首残高'],date:['月','年月','対象月'],amount:['金額','月次金額','残高','月末残高'],category:['分類','分類名','区分'],party:['取引先','取引先名']},required:['account']}
};
TYPES.prior.fields=TYPES.current.fields;TYPES.prior.required=TYPES.current.required;
TYPES.priorPL={...TYPES.monthlyPL,name:'前期・過去のPL',desc:'同じ顧客の前期・過去の単月PL。帳票に記載された年度・年月で保存し、当期PLを上書きしません。',fields:{...TYPES.monthlyPL.fields},required:[...TYPES.monthlyPL.required]};
TYPES.priorBS={...TYPES.monthlyBS,name:'前期・過去のBS',desc:'同じ顧客の前期・過去のBS。前期末と当期の期首残高のつながりを確認。対象開始月より前の帳票を当期BSと分けて保存します。',fields:{...TYPES.monthlyBS.fields},required:[...TYPES.monthlyBS.required]};
const TAG_KEYS=['party','item','department','segment1','segment2','segment3'];
function reportType(type){return ['monthlyPL','priorPL'].includes(type)?'monthlyPL':['monthlyBS','priorBS'].includes(type)?'monthlyBS':null;}
const LABELS={reportedTotal:'CSVの期間累計（月別とは別・任意）',accountCode:'勘定科目コード（任意）',opening:'期首残高（BS・任意）',date:'取引日／月',id:'仕訳番号',exportNo:'CSV内の仕訳No.（複合仕訳のまとまり）',debit:'借方科目',debitAmount:'借方金額',credit:'貸方科目',creditAmount:'貸方金額',party:'取引先',debitParty:'借方取引先',creditParty:'貸方取引先',description:'摘要',debitTax:'借方税区分',creditTax:'貸方税区分',amount:'金額',account:'勘定科目',category:'分類（任意）',balance:'帳簿残高',expected:'資料残高（任意）',due:'決済期日',asOf:'未決済額の基準日（任意）',invoice:'請求書・管理番号（任意）'};
const normalize=s=>String(s??'').normalize('NFKC').trim();
const compact=s=>normalize(s).replace(/\s/g,'');
function parseCSV(text){
 text=String(text).replace(/^\uFEFF/,'');
 const first=text.split(/\r?\n/).slice(0,8).join('\n');
 const delimiter=(first.match(/\t/g)||[]).length>(first.match(/,/g)||[]).length?'\t':',';
 const rows=[];let row=[],cell='',quote=false;
 for(let i=0;i<text.length;i++){const ch=text[i];if(ch==='"'){if(quote&&text[i+1]==='"'){cell+='"';i++;}else if(quote||!cell)quote=!quote;else cell+=ch;}else if(ch===delimiter&&!quote){row.push(cell);cell='';}else if((ch==='\n'||ch==='\r')&&!quote){if(ch==='\r'&&text[i+1]==='\n')i++;row.push(cell);if(row.some(x=>x.trim()))rows.push(row);row=[];cell='';}else cell+=ch;}
 if(quote)throw Error('引用符が閉じていません。元のCSVを再出力してください。');
 row.push(cell);if(row.some(x=>x.trim()))rows.push(row);
 if(rows.length<2)throw Error('見出し行とデータ行が必要です。');return rows;
}
function number(value,blank=null){let s=normalize(value);if(!s||/^[-—–]$/.test(s))return blank;let negative=false;if(/^\(.*\)$/.test(s)){negative=true;s=s.slice(1,-1);}if(/^[△▲]/.test(s)){negative=true;s=s.slice(1);}s=s.replace(/[¥￥円,\s]/g,'');if(!/^[+-]?\d+(\.\d+)?$/.test(s))return NaN;const n=Number(s);return negative?-n:n;}
function monetary(value,unit=1,blank=null){
 let s=normalize(value);if(!s||/^[-—–]$/.test(s))return blank;if(s.length>128||![1,1000].includes(unit))return NaN;
 let negative=false;if(/^\(.*\)$/.test(s)){negative=true;s=s.slice(1,-1).trim();}
 if(/^[△▲]/.test(s)){if(negative)return NaN;negative=true;s=s.slice(1).trim();}
 s=s.replace(/^[¥￥]\s*/,'').replace(/\s*円$/,'');
 if(!/^[+-]?(?:\d+|\d{1,3}(?:,\d{3})+)(?:\.\d+)?$/.test(s)||negative&&/^[+-]/.test(s))return NaN;
 const minus=s.startsWith('-')||negative,parts=s.replace(/^[+-]/,'').replace(/,/g,'').split('.'),fraction=parts[1]||'';
 const divisor=10n**BigInt(fraction.length),scaled=BigInt(parts[0]+fraction)*BigInt(unit);if(scaled%divisor!==0n)return NaN;
 const n=Number(scaled/divisor)*(minus?-1:1);return Number.isSafeInteger(n)?(n===0?0:n):NaN;
}
function date(value,monthOnly=false){const s=normalize(value);const m=s.match(/^(\d{4})[年\/\-.](\d{1,2})(?:[月\/\-.](\d{1,2}))?(?:月|日)?(?:\s.*)?$/);if(!m||(!monthOnly&&!m[3]))return null;const y=+m[1],mo=+m[2],d=m[3]?+m[3]:1;if(y<1900||y>2199||mo<1||mo>12||d<1||d>31)return null;const dt=new Date(Date.UTC(y,mo-1,d));if(dt.getUTCMonth()!==mo-1||dt.getUTCDate()!==d)return null;return `${y}-${String(mo).padStart(2,'0')}${monthOnly?'':`-${String(d).padStart(2,'0')}`}`;}
function monthRange(start,end){if(!/^\d{4}-\d{2}$/.test(start)||!/^\d{4}-\d{2}$/.test(end)||!date(start,true)||!date(end,true)||start>end)return [];let [y,m]=start.split('-').map(Number);const out=[];while(out.length<36){const s=`${y}-${String(m).padStart(2,'0')}`;if(s>end)break;out.push(s);m++;if(m===13){m=1;y++;}}return out;}
function guessMapping(headers,type,cfg){if(reportType(type))return root.ReviewFinancial.guessMapping(headers,reportType(type),cfg||newSession().project);const fields=TYPES[type].fields;const result={};for(const [key,aliases]of Object.entries(fields)){let i=-1;for(const a of aliases){i=headers.findIndex(h=>compact(h)===compact(a));if(i>=0)break;}result[key]=i;}if(['current','prior'].includes(type)&&root.ReviewDetails?.legacyHeader(headers)){if(result.exportNo<0)result.exportNo=0;if(result.id<0)result.id=0;}return result;}
function headerRow(rows,type,cfg){if(reportType(type))return root.ReviewFinancial.headerRow(rows,reportType(type),cfg||newSession().project);let best=0,score=-1;for(let i=0;i<Math.min(20,rows.length-1);i++){const m=guessMapping(rows[i],type);const n=TYPES[type].required.filter(k=>m[k]>=0).length;if(n>score){score=n;best=i;}}return best;}
function normalizeRows(rows,type,mapping,headerIndex=0,options={}){
 if(reportType(type))return root.ReviewFinancial.normalizeReports(rows,reportType(type),mapping,headerIndex,options.project||newSession().project,{...options,priorReport:['priorPL','priorBS'].includes(type)});
 const out=[],errors=[],headers=rows[headerIndex];let last=null;
 const get=(r,k)=>mapping[k]>=0?normalize(r[mapping[k]]):'';
 for(let i=headerIndex+1;i<rows.length;i++){const raw=rows[i];if(raw.every(x=>!normalize(x)))continue;
 let item={line:i+1};const bad=[];
 if(type==='current'||type==='prior'){
  const rawId=get(raw,'id'),rawNo=get(raw,'exportNo'),rawDate=get(raw,'date');
  const idIsNo=mapping.id>=0&&(mapping.id===mapping.exportNo||['No.','No'].some(a=>compact(headers[mapping.id])===compact(a)));
  const sameId=last&&rawId&&rawId===last.id;
  const sameNo=last&&rawNo&&rawNo===last.exportNo&&(!rawId||idIsNo||last.idKind!=='journal'||rawId===last.id);
  // Carry metadata only over a valid, identified continuation. A blank date
  // and blank numbers can extend an unfinished group, but never a closed one.
  const blankContinuation=last&&!rawDate&&!rawId&&!rawNo&&last.hasId&&Math.abs(last.net)>.01;
  const continuation=!!last&&!rawDate&&(sameId||sameNo||blankContinuation);
  let dt=rawDate?date(rawDate):continuation?last.date:null;
  let id=rawId,idKind=rawId?(idIsNo?'export':'journal'):'';
  if(!id&&sameNo&&(!rawDate||dt===last.date)&&last.idKind==='journal'){id=last.id;idKind='journal';}
  if(!id&&rawNo){id=rawNo;idKind='export';}
  if(!id&&continuation){id=last.id;idKind=last.idKind;}
  const exportNo=rawNo||(continuation?last.exportNo:'');
  if(!dt)bad.push('日付');const debit=get(raw,'debit'),credit=get(raw,'credit'),da=monetary(get(raw,'debitAmount'),1,debit?null:0),ca=monetary(get(raw,'creditAmount'),1,credit?null:0);
  if(!Number.isSafeInteger(da))bad.push('借方金額（円整数が必要）');if(!Number.isSafeInteger(ca))bad.push('貸方金額（円整数が必要）');
  if(!debit&&!credit)bad.push('科目');if(da!==0&&!debit)bad.push('借方科目');if(ca!==0&&!credit)bad.push('貸方科目');
  item={...item,date:dt,id:id||`行${i+1}`,hasId:!!id,idKind,exportNo,journalId:id||`行${i+1}`,journalIdKind:idKind||'row',metadataInherited:continuation||(!rawId&&idKind==='journal'),debit,credit,debitAmount:da,creditAmount:ca,party:get(raw,'party'),debitParty:get(raw,'debitParty'),creditParty:get(raw,'creditParty'),description:get(raw,'description'),debitTax:get(raw,'debitTax'),creditTax:get(raw,'creditTax')};
  if(root.ReviewDetails)item={...item,...root.ReviewDetails.capture(headers,raw,mapping)};
  if(bad.length)last=null;
  else{const same=last&&dt===last.date&&((id&&id===last.id)||(exportNo&&exportNo===last.exportNo));last={...item,net:(same?last.net:0)+da-ca};}
 }else if(type==='unregistered'){
  const dt=date(get(raw,'date')),amount=monetary(get(raw,'amount'));if(!dt)bad.push('日付');if(!Number.isSafeInteger(amount))bad.push('金額（円整数が必要）');
  const h=headers.map(compact),hasIn=h.some(x=>['入金額','収入金額'].includes(x)),hasOut=h.some(x=>['出金額','支出金額','支払金額'].includes(x));
  if(hasIn&&hasOut&&h[mapping.amount]!=='金額')bad.push('入金・出金は1列の金額に統合してください');
  item={...item,date:dt,amount,description:get(raw,'description'),party:get(raw,'party')};
 }else if(type==='balances'){
  const dt=date(get(raw,'date'),true),balance=monetary(get(raw,'balance')),expected=monetary(get(raw,'expected'));if(!dt)bad.push('月');if(!get(raw,'account'))bad.push('科目');if(!Number.isSafeInteger(balance))bad.push('残高（円整数が必要）');if(expected!==null&&!Number.isSafeInteger(expected))bad.push('資料残高（円整数が必要）');item={...item,date:dt,account:get(raw,'account'),party:get(raw,'party'),balance,expected};
 }else if(type==='aging'){
  const due=date(get(raw,'due')),dt=get(raw,'date')?date(get(raw,'date')):null,amount=monetary(get(raw,'amount')),asOf=get(raw,'asOf')?date(get(raw,'asOf')):null;if(!due)bad.push('期日');if(get(raw,'date')&&!dt)bad.push('発生日');if(get(raw,'asOf')&&!asOf)bad.push('残高基準日');if(!get(raw,'account'))bad.push('科目');if(!Number.isSafeInteger(amount))bad.push('未決済額（円整数が必要）');item={...item,date:dt,account:get(raw,'account'),party:get(raw,'party'),due,amount,asOf,invoice:get(raw,'invoice')};
 }
 if(bad.length)errors.push({line:i+1,fields:bad});else out.push(item);
 }
 if(type==='current'||type==='prior'){
  const groups=new Map();for(const r of out)if(r.exportNo){const k=JSON.stringify([r.date,r.exportNo]),g=groups.get(k)||[];g.push(r);groups.set(k,g);}
  // A unique explicit journal number can identify No. continuation rows even
  // when the explicit number appears only on a later line in the CSV.
  for(const group of groups.values()){
   const ids=new Set(group.filter(r=>r.idKind==='journal').map(r=>r.id));
   for(const r of group){r.journalAmbiguous=ids.size>1;r.journalId=ids.size===1?[...ids][0]:r.exportNo;r.journalIdKind=ids.size===1?'journal':'export';}
  }
 }
 const grouped=(type==='current'||type==='prior')?journalGroups(out):[];
 const journalStats=(type==='current'||type==='prior')?{groups:grouped.length,balanced:grouped.filter(rs=>!rs.some(r=>r.journalAmbiguous)&&Math.abs(rs.reduce((n,r)=>n+r.debitAmount-r.creditAmount,0))<=.01).length,inherited:out.filter(r=>r.metadataInherited).length,ambiguous:grouped.filter(rs=>rs.some(r=>r.journalAmbiguous)).length}:null;
 const detailStats=journalStats&&root.ReviewDetails?root.ReviewDetails.stats(out,headers,mapping):null;
 return {items:out,errors,headers,journalStats,detailStats};
}
function journalKey(r){
 const scope=r.importSource||r.historySource||r.source||'';
 const kind=r.journalIdKind||(r.hasId?'legacy':'row');
 return JSON.stringify([r.date,scope,kind,r.journalId||(r.hasId?r.id:r.line)]);
}
function journalGroups(rows){const groups=new Map();for(const r of rows){const k=journalKey(r),g=groups.get(k)||[];g.push(r);groups.set(k,g);}return [...groups.values()];}
function plKind(a){if(/^(売上高|売上|売上収益|営業収益|報酬売上)/.test(a))return 'sales';if(/(仕入高|仕入|外注費|売上原価)/.test(a))return 'cost';if(/(地代家賃|家賃|賃借料)/.test(a))return 'rent';if(/(役員報酬|給料|給与|賃金|賞与|法定福利費)/.test(a))return 'salary';if(/(費$|料$|支払手数料|租税公課|福利厚生|保険料|雑損失|雑収入|受取利息|受取配当金)/.test(a))return 'other';return null;}
function hash(s){let h=2166136261;for(let i=0;i<s.length;i++){h^=s.charCodeAt(i);h=Math.imul(h,16777619);}return (h>>>0).toString(36);}
function journalPeriod(items,cfg){
 const counts={prior:0,current:0,future:0};
 if(!monthRange(cfg.start,cfg.end).length)return {...counts,kind:'invalid',recommended:null};
 for(const r of items){if(!r.date)continue;const month=r.date.slice(0,7);counts[month<cfg.start?'prior':month>cfg.end?'future':'current']++;}
 const kind=counts.prior?(counts.current||counts.future?'mixed':'prior'):counts.current?'current':counts.future?'future':'empty';
 return {...counts,kind,recommended:['prior','current'].includes(kind)?kind:null};
}
function reportPeriod(items,type,cfg,stats={}){
 const base=reportType(type),counts={prior:0,current:0,future:0},months=[...new Set([...(items||[]).filter(r=>!r.opening).map(r=>date(r.date,true)),...(stats.declaredMonths||[]).map(m=>date(m,true))].filter(Boolean))].sort();
 if(!base)return {...counts,months,kind:'not-report',recommended:null};
 if(!monthRange(cfg.start,cfg.end).length)return {...counts,months,kind:'invalid',recommended:null};
 for(const m of months)counts[m<cfg.start?'prior':m>cfg.end?'future':'current']++;
 const boundary=base==='monthlyBS'?root.ReviewFinancial.prevMonth(cfg.start):null,old=months.filter(m=>m<cfg.start&&m!==boundary),source=stats.sourcePeriod;
 const declared=source&&monthRange(source.start,source.end),coherent=declared?.length>0&&declared.length<=12&&declared.at(-1)===source.end&&months.every(m=>m>=source.start&&m<=source.end);
 let kind=!months.length?'empty':!counts.current&&!counts.future?'prior':!counts.current&&!counts.prior?'future':counts.current&&(!old.length||coherent)?'current':'mixed';
 if(kind==='prior'&&source?.end>=cfg.start)kind='mixed';
 const recommended=kind==='prior'?(base==='monthlyBS'?'priorBS':'priorPL'):kind==='current'?base:null;
 return {...counts,months,kind,recommended,start:months[0]||null,end:months.at(-1)||null,boundaryMonths:months.filter(m=>m===boundary)};
}
function importMapping(rows,type,h,cfg){const meta=reportType(type)?root.ReviewFinancial.reportMetadata(rows,h):null;return guessMapping(rows[h],type,meta?.periodValid?{...cfg,start:meta.start,end:meta.end}:cfg);}
function detectReportType(rows,cfg){
 const F=root.ReviewFinancial,h=F.headerRow(rows,'monthlyPL',cfg),meta=F.reportMetadata(rows,h),datedCfg=meta.periodValid?{...cfg,start:meta.start,end:meta.end}:cfg,head=rows[h],mapping=F.guessMapping(head,'monthlyPL',datedCfg),bsMapping=F.guessMapping(head,'monthlyBS',datedCfg);
 const wide=head.some(x=>/^(?:\d{4}[年\/\-.]\d{1,2}月?|\d{1,2}月)$/.test(normalize(x))),long=(mapping.account>=0&&mapping.date>=0&&mapping.amount>=0)||(bsMapping.account>=0&&bsMapping.date>=0&&bsMapping.amount>=0);
 if(!wide&&!long&&!/(?:損益計算書|貸借対照表)/.test(meta.title))return null;
 const type=/貸借対照表/.test(meta.title)||bsMapping.opening>=0||long&&/残高/.test(normalize(head[bsMapping.amount]))?'monthlyBS':'monthlyPL',actualMapping=F.guessMapping(head,type,datedCfg);
 const preview=normalizeRows(rows,type,actualMapping,h,{project:cfg,unit:F.detectUnit(rows,h),basis:F.detectBasis(rows,h),requireReportYear:true}),period=reportPeriod(preview.items,type,cfg,preview.reportStats||{});
 return {type:period.recommended||type,baseType:type,headerIndex:h,mapping:actualMapping,period,preview};
}
function inPeriod(dt,cfg){return !!dt&&dt.slice(0,7)>=cfg.start&&dt.slice(0,7)<=cfg.end;}
function median(ns){const a=ns.slice().sort((a,b)=>a-b);if(!a.length)return 0;const i=Math.floor(a.length/2);return a.length%2?a[i]:(a[i-1]+a[i])/2;}
function analyze(session){
 const cfg=session.project,ds=session.datasets,months=monthRange(cfg.start,cfg.end),current=(ds.current||[]).filter(r=>inPeriod(r.date,cfg)),balances=(ds.balances||[]).filter(r=>inPeriod(r.date,cfg)),findings=[];
 // 確認結果は、その時点の資料と判定条件にだけ適用する。更新前のメモは削除せず、旧IDの記録として残す。
 const reviewFields=[...new Set(['id','line','date','due','account','debit','credit','party','sharedParty','debitParty','creditParty','debitTax','creditTax','debitAmount','creditAmount','amount','balance','expected','asOf','invoice','description','source','importSource','historySource','importErrors','hasId','journalId','journalIdKind','journalAmbiguous','opening','openingRaw','statement','role','unit','approximate','basis','tagDimension','tagValue','reportStart','reportEnd','reportEntity','reportedTotal','reportedTotalRaw','reportedTotalMonths',...Object.keys(root.ReviewDetails?.fields||{})])];
 const rowReview=r=>JSON.stringify([reviewFields.map(k=>[k,r[k]??null]),Object.entries(r.fieldOrigins||{}).sort(([a],[b])=>a.localeCompare(b)),(r.sourceFields||[]).map(x=>[x.column,x.header,x.value]).sort((a,b)=>a[0]-b[0])]);
 const reviewSettings=JSON.stringify([[cfg.type,cfg.start,cfg.end,cfg.large,cfg.variance,!!cfg.complete],Object.entries(session.financial||{}).sort(([a],[b])=>a.localeCompare(b)).map(([k,v])=>[k,k==='accountRoles'?Object.entries(v||{}).sort(([a],[b])=>a.localeCompare(b)):v])]);
 const reportReviews=new Map(),reportReview=account=>{if(!account)return '';if(!reportReviews.has(account))reportReviews.set(account,hash(JSON.stringify(['monthlyPL','monthlyBS','priorPL','priorBS'].map(type=>[type,(ds[type]||[]).filter(r=>r.account===account&&(['priorPL','priorBS'].includes(type)||r.opening||inPeriod(r.date,cfg)||r.date===root.ReviewFinancial?.prevMonth(cfg.start))).map(rowReview).sort()]))));return reportReviews.get(account);};
 const add=(check,title,reason,amount,rows=[],opts={})=>{const signature=rows.map(rowReview).sort(),context=[reason,amount,opts.level||'candidate',!!opts.dataReview,opts.account||'',opts.months||[],opts.reviewContext||'',reviewSettings,opts.monthlyCheck||check==='monthly'?reportReview(opts.account):''];const f={id:hash(JSON.stringify(['review-evidence-v2',check,title,signature,context])),check,title,reason,amount,rows,level:opts.level||'candidate',basis:opts.basis||'内部チェックの着眼点',lesson:opts.lesson||reason,steps:opts.steps||['該当の元帳・証憑を開く。','取引内容と計上・決済のタイミングを照合する。','確認した根拠をメモに記録する。'],sources:opts.sources||['sheet'],...opts};findings.push(f);return f;};
 if(!months.length)return {findings,months,current,coverage:[],pl:[],journalBalances:[],financial:null};
 const history=root.ReviewHistory?.build(session)||null;
 // A CSV row is not necessarily a complete journal. Never infer grouping
 // from equal amounts, matching descriptions, or a common counterparty.
 const journalBalances=journalGroups(current).map(rows=>{
  const debit=rows.reduce((s,r)=>s+r.debitAmount,0),credit=rows.reduce((s,r)=>s+r.creditAmount,0);
  const ambiguous=rows.some(r=>r.journalAmbiguous),identified=rows.every(r=>r.hasId)&&!ambiguous;
  const readErrors=rows.some(r=>r.importErrors>0)||(session.imports||[]).some(i=>i.type==='current'&&i.errors>0&&rows.some(r=>r.source===i.name));
  return {key:journalKey(rows[0]),rows,debit,credit,difference:debit-credit,ambiguous,identified,complete:!!cfg.complete&&identified&&!readErrors,readErrors};
 });
 for(const b of journalBalances){
  if(Math.abs(b.difference)<=.01&&!b.ambiguous)continue;
  const limitation=b.ambiguous?'同じNo.に異なる仕訳番号があるため、番号の対応を確認してください。':!b.identified?'仕訳番号・No.がなく、この行が仕訳全体か分かりません。':b.readErrors?'読取エラーで除外した行があります。仕訳の全行がそろっているか確認してください。':!cfg.complete?'対象期間の全行・全科目を読み込んだか未確認です。':'原CSV・freeeの仕訳帳で合計と読込範囲を照合してください。';
  add('evidence',b.complete?'読み込んだ仕訳の貸借合計に差額':'貸借確認の前に、読込範囲・仕訳のまとまりを確認',`読込 ${b.rows.length}行の合計：借方 ${b.debit.toLocaleString()}円、貸方 ${b.credit.toLocaleString()}円。${limitation}`,b.difference,b.rows,{
   level:b.complete?'difference':'info',balanceCheck:true,dataReview:!b.complete,balanceTotals:{debit:b.debit,credit:b.credit},
   lesson:`複合仕訳は、手数料と銀行などに分かれた全行を合計して確認します。1行の借貸差額は、そのまま仕訳の誤りにはなりません。${limitation}${b.complete?'全行指定済みの資料で差額が残っています。':'全行・番号の対応が確認できるまで、修正は保留します。'}`,
   steps:['freeeの仕訳帳で、該当仕訳の手数料・預金・債務などの全行を表示する。','対象期間の仕訳帳を科目で絞らずCSV出力し、仕訳番号とNo.の列対応を確認して置き換え読込する。','「資料の読込」で全取引・全口座を含むか確認し、再集計後にも差額が残る場合に元資料を調べてメモに記録する。'],
   basis:b.complete?'利用者が全行指定した資料内の、同一仕訳に属する行の借貸合計':'貸借判定に必要な資料範囲・仕訳番号の確認',sources:['freee']
  });
 }
 const fingerprints=new Map();for(const r of current){const k=[r.date,r.debit,r.credit,r.debitAmount,r.creditAmount,r.debitParty||r.party,r.creditParty||r.party,compact(r.description),root.ReviewDetails?.fingerprint(r)||''].join('|');const g=fingerprints.get(k)||[];g.push(r);fingerprints.set(k,g);}
 for(const rows of fingerprints.values()){const ids=new Set(rows.map(journalKey));if(ids.size>1)add('duplicate','同日・同内容の別仕訳がある',`${rows.length}行で日付・借貸科目・金額・取引先・摘要・記載された品目やメモが一致。別の取引か、明細と手入力の二重計上かを確認します。`,rows[0].debitAmount||rows[0].creditAmount,rows,{lesson:'同じ金額・同じ日でも、別の購入なら重複ではありません。番号の違いと証憑・決済元を確認することが、削除する前の判断材料です。',steps:['freeeで表示した仕訳番号を検索する。','各仕訳に対応する明細・請求書が別々に存在するか確認する。','重複かどうかの結論と根拠を記録する。']});}
 const groups=new Map(),pl=new Map(),observedMonths=new Set(current.map(r=>r.date.slice(0,7)));
 const sides=[];for(const r of current){for(const side of ['debit','credit']){const account=r[side],amount=r[side+'Amount'];if(!account||!amount)continue;const kind=plKind(account),party=r[side+'Party']||r.party||'';
 const normalCredit=kind==='sales'||/雑収入|受取利息|受取配当金/.test(account);
 const signed=normalCredit?(side==='credit'?amount:-amount):(side==='debit'?amount:-amount);
 const entry={...r,sharedParty:r.party,account,party,amount,side,kind};sides.push(entry);if(kind){const pk=account+'|'+party;const g=groups.get(pk)||{account,party,kind,values:Object.fromEntries(months.map(m=>[m,0])),rows:[]};g.values[r.date.slice(0,7)]+=signed;g.rows.push(entry);groups.set(pk,g);const p=pl.get(account)||{account,kind,values:Object.fromEntries(months.map(m=>[m,0]))};p.values[r.date.slice(0,7)]+=signed;pl.set(account,p);}}}
 for(const e of sides){if(e.side!=='debit'||e.amount<=0)continue;
  if(/消耗品/.test(e.account)&&e.amount>=100000){const t=root.ReviewInsight?.assetText(e,cfg)||{};add('asset','消耗品の高額な明細',t.reason||`${e.account}に ${e.amount.toLocaleString()}円の支出。取得単位と処理方針を確認します。`,e.amount,[e],{...(t.lesson?{basis:t.basis,tags:t.tags,sources:['sheet','smalldep','smallasset','asset']}:{}),lesson:t.lesson||'10万円はチェックシートの抽出基準です。明細に複数個の資産や消耗品が含まれることもあります。税込／税抜、1組の範囲、事業使用、適用する制度を確認して判断します。',steps:t.steps||['請求書の品名・数量・1組の取得価額を確認する。','使用期間・使用開始日・税込／税抜の経理方法を確認する。','固定資産台帳と事務所の処理方針を照合する。'],sources:t.lesson?['sheet','smalldep','smallasset','asset']:['sheet','asset']});}
  if(/修繕/.test(e.account)&&e.amount>=200000){const t=root.ReviewInsight?.repairText(e,cfg)||{};add('asset','修繕費の高額な明細',t.reason||`${e.amount.toLocaleString()}円の修繕費。原状回復か、性能・価値を増やす工事かを確認します。`,e.amount,[e],{lesson:t.lesson||'20万円以上でも通常の維持管理・原状回復なら修繕費となり得ます。金額だけで資本的支出に変更せず、工事の実質と適用基準を確認します。',...(t.steps?{steps:t.steps,basis:t.basis}:{}),sources:['sheet',cfg.type==='individual'?'repairP':'repairC']});}
  if(cfg.type==='individual'&&plKind(e.account)){
   const text=root.ReviewDetails?root.ReviewDetails.contextText(e,e.side):e.description+' '+e.party;const match=text.match(/国民年金|国民健康保険|国保(?:料|税)?|小規模企業共済|生命保険|(?:確定|予定|申告)所得税|所得税|住民税/);
   if(match)add('personal',`本人の私的支出が経費に混在している可能性`,`${e.account}の摘要等に「${match[0]}」があります。本人分・従業員分・契約の内容を確認します。`,e.amount,[e],{lesson:'本人分の所得税・住民税や所得控除となる掛金と、従業員分の預り金・事業上の支払は分けて考えます。摘要の言葉だけでは確定せず、支払先と負担者を確認してください。',steps:['誰の税金・保険料・掛金か確認する。','従業員分の納付・事業の保険契約と区別する。','本人分と確認できた場合の事業主勘定への振替を上司に確認し、メモする。'],sources:['expense','social','mutual','tags'],decisionEvidence:root.ReviewDetails?root.ReviewDetails.evidence(e,e.side).filter(f=>f.value.includes(match[0])).map(f=>f.label+'「'+f.value+'」'):[]});
  }
  if(e.kind&&e.amount>=cfg.large&&!(root.ReviewDetails?root.ReviewDetails.narrative(e,e.side):e.description)&&!e.party)add('evidence','高額支出の内容がCSVから分からない',`取引先・摘要・品目・メモに内容の記載がなく ${e.amount.toLocaleString()}円。証憑の保存有無はCSVから判断できません。`,e.amount,[e],{lesson:'摘要が空でも証憑がfreeeに保存されている可能性があります。まず関連ファイルを開き、用途と科目が説明できるか確認します。'});
 }
 const prior=history?history.rows:ds.prior||[];if(prior.length){const previous=new Set();for(const r of prior){for(const s of ['debit','credit'])if(plKind(r[s]))previous.add(r[s]+'|'+(r[s+'Party']||r.party||''));}for(const [key,g]of groups)if(!previous.has(key)&&g.rows.reduce((s,r)=>s+Math.abs(r.amount),0)>=cfg.large)add(g.kind==='sales'?'sales':g.kind==='cost'?'cost':'other','過去資料にない科目・取引先の組み合わせ',`${g.account}／${g.party||'取引先タグなし'}。参照対象の過去資料では同じ組み合わせが見つかりません。`,g.rows.reduce((s,r)=>s+Math.abs(r.amount),0),g.rows,{lesson:'タグの表記変更や資料の範囲外でも「新規」に見えます。過去に同じ名前があることも、当期処理が正しい証明にはなりません。',steps:['過去資料の期間・網羅性・タグの表記を確認する。','当期の新規契約や取引の実態を確認する。','過去の決算修正がある場合は修正後の処理を参照する。']});}
 for(const g of groups.values()){
  const values=months.map(m=>g.values[m]),positive=values.filter(v=>v>0),base=median(positive);if(positive.length<3||base<=0)continue;
  const key=g.kind==='rent'?'rent':g.kind==='salary'?'salary':g.kind==='sales'?'sales':g.kind==='cost'?'cost':'other';
  const missing=months.filter(m=>observedMonths.has(m)&&g.values[m]===0);if(cfg.complete&&missing.length)add(key,'継続する科目・取引先に計上のない月',`${g.account}／${g.party||'取引先タグなし'}：${missing.join('、')} の純額が0円。欠落・相殺・解約を確認します。`,0,g.rows,{lesson:'全期間を含むと指定されたデータで、他の3か月以上に発生している組み合わせを確認しました。仕訳のある月のみ比較し、未読込の月を0円とは扱いません。純額ゼロでも返金や訂正で相殺された可能性があります。',steps:['該当月の元帳で返金・取消・科目変更を確認する。','契約の開始・終了や取引休止の有無を確認する。','未登録明細と原資料に計上漏れがないか照合する。'],basis:'利用者指定の網羅性と、仕訳のある月の継続取引の純額による抽出'});
  for(const m of months){const val=g.values[m],diff=val-base;if(val!==0&&Math.abs(diff)>=cfg.large&&Math.abs(diff)/base>=cfg.variance)add(key,'通常月から金額が大きく変わっている',`${g.account}／${g.party||'取引先タグなし'}：${m} は ${val.toLocaleString()}円。発生月の中央値 ${base.toLocaleString()}円と比較。`,val,g.rows.filter(r=>r.date.startsWith(m)),{lesson:'この差は誤りの証明ではありません。契約変更、賞与、年払い、季節変動、訂正や返品でも増減します。比較の基準はこのデータ内の発生月の中央値です。',basis:`差額${cfg.large.toLocaleString()}円以上、変動${Math.round(cfg.variance*100)}%以上の利用者設定`});}
 }
 const repeat=new Map();for(const e of sides){if(e.side==='debit'&&e.amount>0&&e.kind&&e.kind!=='sales'&&e.party){const k=e.account+'|'+e.party;const a=repeat.get(k)||[];a.push(e);repeat.set(k,a);}}
 for(const rows of repeat.values())if(new Set(rows.map(r=>r.date.slice(0,7))).size>=3)add('rules','反復支出から自動登録ルールの候補',`${rows[0].party}／${rows[0].account} が3か月以上で反復。既存ルールと取引内容を確認して候補化できます。`,rows.reduce((s,r)=>s+r.amount,0),rows,{level:'info',lesson:'同じ取引先でも用途・税区分・科目が変わることがあります。摘要条件や口座を絞り、既存ルールを確認してから推測／登録を選びます。',steps:['既存の自動登録ルールを確認する。','例外の取引が同じ条件に混ざらないか確認する。','安全に限定できる条件案を上司に共有する。']});
 const tmp=new Map();for(const b of balances){
  const rows=[b];let check=/借入金|リース債務/.test(b.account)?'loan':/役員/.test(b.account)?'director':/カード|クレジット|クレカ/.test(b.account)?'card':'cash';
  if(b.expected!==null&&Math.abs(b.balance-b.expected)>.01)add(check,'帳簿残高と資料残高に差額',`${b.date} ${b.account}：帳簿 ${b.balance.toLocaleString()}円／資料 ${b.expected.toLocaleString()}円。`,b.balance-b.expected,rows,{level:'difference',lesson:'同じ日付・同じ契約／口座の残高を比較しているかが第一です。締日、返済日、休日の引落、未登録や二重登録を順に確認します。',basis:'利用者が入力した同一基準日の帳簿残高と資料残高の差額'});
  if(b.balance<0&&/現金|普通預金|当座預金|借入金|リース債務|役員借入金/.test(b.account))add(check,'通常の残高方向と逆になっている',`${b.date} ${b.account} の残高 ${b.balance.toLocaleString()}円。残高の符号の定義と実際の残高を確認します。`,b.balance,rows,{lesson:'残高一覧は科目の通常方向を正とした値を入力してください。預金の当座貸越や返済・振替のタイミングもあるため、負数だけで修正を決めません。'});
  if(/未確定損益|仮払金|仮受金/.test(b.account)&&b.balance!==0){const k=b.account+'|'+b.party;const a=tmp.get(k)||[];a.push(b);tmp.set(k,a);}
 }
 for(const rows of tmp.values()){const b=rows.sort((a,b)=>a.date.localeCompare(b.date)).at(-1);add('temp','暫定科目の残高の内容を確認',`${b.date} ${b.account}／${b.party||'分類なし'} の残高 ${b.balance.toLocaleString()}円。`,b.balance,rows,{lesson:'未確定損益は内容の確定が必要です。一方、仮払金には精算前の正常な残高もあります。発生日、用途、精算期限を確認して、説明できないものを質問します。',steps:['該当残高を構成する取引を元帳で確認する。','立替・仮払の目的と精算予定を確認する。','内容不明の明細だけをお客様への質問として残す。']});}
 const lastDay=new Date(Date.UTC(+cfg.end.slice(0,4),+cfg.end.slice(5),0)).getUTCDate();const endDate=cfg.end+'-'+String(lastDay).padStart(2,'0');
 for(const r of ds.aging||[]){if(r.amount>0&&r.due<endDate&&(!r.date||r.date<=endDate)){const c=/売掛|未収/.test(r.account)?'ar':'ap',confirmed=(r.asOf||session.financial?.agingAsOf)===endDate;add(c,confirmed?'決済期日を過ぎた未決済額':'対象末日時点の未決済額と期日を確認',`${r.account}／${r.party||'取引先なし'}：期日 ${r.due}、一覧の未決済 ${r.amount.toLocaleString()}円。${confirmed?'対象末日時点の残額と指定。':'未決済額の基準日が対象末日と一致するか未確認。'}`,r.amount,[r],{monthlyCheck:c==='ar',account:r.account,level:confirmed?'candidate':'info',dataReview:!confirmed,lesson:'期日一覧が対象末日時点のものか確認してください。支払や入金が済んでいても未消込の可能性があり、残高だけで未納・未回収とは判断できません。',basis:'対象末日時点の利用者指定期日と未決済額',steps:['対象末日時点の一覧か確認する。','銀行明細に入金／支払があるか照合する。','未決済と未消込を分けて確認結果を記録する。']});}}
 for(const r of ds.unregistered||[]){if(!r.date||r.date>endDate)continue;const days=Math.round((Date.parse(endDate+'T00:00:00Z')-Date.parse(r.date+'T00:00:00Z'))/86400000);if(Math.abs(r.amount)>=cfg.large||days>=90)add('unreg',Math.abs(r.amount)>=cfg.large?'高額な未登録明細':'長期の未登録明細',`${r.date}／${r.description||r.party||'内容未入力'}。対象末日から${days}日前。`,r.amount,[r],{lesson:'未登録のため、この明細は仕訳の集計に含まれていません。件数が多ければ記帳を促し、高額なものは内容・資料の確認候補として残します。',basis:`高額${cfg.large.toLocaleString()}円以上／滞留90日以上の抽出`});}
 for(const e of sides)if(/雑収入|雑損失/.test(e.account))add('misc','雑収入・雑損失の内容を説明できるか',`${e.account}／${e.description||'摘要なし'}。内容と使用科目の妥当性を確認します。`,e.amount,[e]);
 if(cfg.type==='corp'){const byJournal=new Map(journalGroups(current).map(g=>[journalKey(g[0]),g]));for(const e of sides)if(e.side==='credit'&&/受取利息|受取配当金/.test(e.account)&&e.amount>0){const t=root.ReviewInsight?.interestText(e,byJournal.get(journalKey(e))||[e])||{};add('interest','利息・配当の支払通知との照合',t.reason||`${e.account} ${e.amount.toLocaleString()}円。入金と源泉徴収等の内訳を原資料で確認します。`,e.amount,[e],{lesson:t.lesson||'入金額だけでは源泉税・配当の条件を確定できません。支払通知にある総額、税額、入金額と帳簿を照合します。',steps:['利息計算書・配当の支払通知で、差引前の額・税額・入金額を確認する。','受取利息（差引前）と差し引かれた税金（法人税等・仮払税金）に分けて記録されているか確認する。','確認した内容をメモに残す。'],sources:['interestTax']});}}
 if(history)root.ReviewHistory.addFindings(history,current,add);
 root.ReviewDetails?.addFindings(session,current,add);
 try{root.ReviewInsight?.addFindings(session,current,history,add,findings);}catch(err){if(typeof console!=='undefined')console.warn('ReviewInsight',err);}
 const financial=root.ReviewFinancial?.build(session,current,months)||null;
 if(financial)root.ReviewFinancial.addFindings(financial,session,add);
 root.ReviewDetails?.enrich(findings);
 root.ReviewInsight?.enrich(findings,{endDate,large:cfg.large,cfg});
 const coverage=CHECKS.map(c=>{const disabled=(c.corp&&cfg.type!=='corp')||(c.individual&&cfg.type!=='individual');const data=c.key==='context'?current.filter(r=>r.sourceFields?.length||root.ReviewDetails?.fingerprint(r)).length:c.key==='monthly'?(current.length+(ds.monthlyPL||[]).length+(ds.monthlyBS||[]).length):c.key==='ar'?((ds.aging||[]).length+(financial?.receivables.flows.reduce((n,g)=>n+g.rows.length,0)||0)+(financial?.receivables.closing!==null&&financial?.receivables.closing!==undefined?1:0)):c.key==='continuity'?(current.length&&history?.stats.journals):c.dataset==='current'?current.length:c.dataset?(ds[c.dataset]||[]).length:0;const fs=findings.filter(f=>f.check===c.key);return {...c,disabled,count:fs.length,state:disabled?'対象外':c.mode==='manual'?(fs.length?'確認候補あり（一部自動）':'手動確認'):!data&&!fs.length?'資料未読込':fs.length?'確認候補あり':'抽出条件に該当なし'};});
 findings.sort((a,b)=>({difference:0,candidate:1,info:2}[a.level]-({difference:0,candidate:1,info:2}[b.level]))||Math.abs(b.amount)-Math.abs(a.amount));
 for(const g of pl.values())for(const m of months)if(!observedMonths.has(m))g.values[m]=null;
 return {findings,months,current,coverage,pl:[...pl.values()],endDate,history,journalBalances,financial};
}
function newSession(){return {schema:1,project:{name:'新しい自計化レビュー',type:'individual',start:'2026-01',end:'2026-06',large:100000,variance:.5,complete:false},datasets:{current:[],prior:[],unregistered:[],balances:[],aging:[],monthlyPL:[],monthlyBS:[],priorPL:[],priorBS:[]},tagReports:[],financial:{comparisonConfirmed:false,agingAsOf:'',agingComplete:false,accountRoles:{}},imports:[],decisions:{},manual:{},history:{sources:{},excludeAdjustments:true},teacher:{turns:[]},updatedAt:null,demo:false};}
function demoSession(){const s=newSession();s.project.name='さいとう事務所｜操作サンプル（架空）';s.project.complete=true;s.demo=true;let i=1;const add=(dt,d,c,n,p,x)=>s.datasets.current.push({date:dt,id:String(i++),hasId:true,debit:d,credit:c,debitAmount:n,creditAmount:n,party:p,debitParty:'',creditParty:'',description:x,source:'操作サンプル',line:i});
 for(let m=1;m<=6;m++){const mo=String(m).padStart(2,'0');add(`2026-${mo}-25`,'給料手当','未払金',m===6?620000:280000,'従業員','給与計上');if(m!==4)add(`2026-${mo}-27`,'地代家賃','普通預金',98000,'東都不動産','事務所家賃');add(`2026-${mo}-28`,'売掛金','売上高',m===5?180000:520000,'青山商事','業務報酬');add(`2026-${mo}-15`,'通信費','普通預金',11000,'通信サービス','月額通信費');}
 add('2026-03-08','消耗品費','普通預金',198000,'PCショップ','ノートPC');add('2026-05-10','修繕費','普通預金',330000,'設備工事','事務所内装');add('2026-02-14','租税公課','普通預金',46000,'市区町村','本人の住民税');add('2026-03-22','法定福利費','普通預金',17100,'年金機構','国民年金（事業主本人）');add('2026-06-02','旅費交通費','普通預金',8800,'JR','出張交通費');add('2026-06-02','旅費交通費','普通預金',8800,'JR','出張交通費');
 s.datasets.balances=[{date:'2026-06',account:'普通預金',party:'事業口座',balance:1523400,expected:1503400,line:2,source:'操作サンプル'},{date:'2026-06',account:'現金',party:'事業現金',balance:-18000,expected:null,line:3,source:'操作サンプル'},{date:'2026-06',account:'借入金',party:'A信金',balance:2200000,expected:2180000,line:4,source:'操作サンプル'},{date:'2026-06',account:'仮払金',party:'内容不明',balance:120000,expected:null,line:5,source:'操作サンプル'}];
 s.datasets.aging=[{date:'2026-02-28',due:'2026-03-31',account:'売掛金',party:'北辰産業',amount:180000,line:2,source:'操作サンプル'},{date:'2026-03-31',due:'2026-04-30',account:'未払金',party:'備品店',amount:66000,line:3,source:'操作サンプル'}];s.datasets.unregistered=[{date:'2026-02-03',amount:260000,description:'用途不明の出金',party:'',line:2,source:'操作サンプル'}];
 s.datasets.prior=s.datasets.current.filter(r=>['給料手当','地代家賃','通信費'].includes(r.debit)||r.credit==='売上高').map(r=>({...r,date:r.date.replace('2026','2025'),source:'2025年・操作サンプル',historySource:'hsrc:sample2025'}));
 for(const y of [2023,2024,2025])s.datasets.prior.push({date:y+'-03-08',id:'PC'+y,hasId:true,debit:'工具器具備品',credit:'普通預金',debitAmount:198000,creditAmount:198000,party:'PCショップ',description:'ノートPC',source:y+'年・操作サンプル',historySource:'hsrc:sample'+y,line:2});
 for(const y of [2023,2024,2025])s.history.sources['hsrc:sample'+y]={name:y+'年・操作サンプル',status:'confirmed',note:'架空のデモ用。実務の正解ではありません。'};
 s.imports=Object.keys(s.datasets).filter(k=>s.datasets[k].length).map(k=>({type:k,name:'操作サンプル（架空）',count:s.datasets[k].length,at:new Date().toISOString()}));return s;
}
function validateSession(x){
 const months=x?.project?monthRange(x.project.start,x.project.end):[];
 if(!x||x.schema!==1||!x.project||!x.datasets||!months.length||months.at(-1)!==x.project.end)throw Error('このアプリの有効なバックアップではありません。');
 if(!['individual','corp'].includes(x.project.type)||!Number.isFinite(x.project.large)||x.project.large<1||!Number.isFinite(x.project.variance)||x.project.variance<=0)throw Error('設定値が不正です。');
 const s=newSession();s.project={...s.project,...x.project};s.demo=!!x.demo;s.updatedAt=x.updatedAt||null;
 s.imports=Array.isArray(x.imports)?x.imports:[];s.decisions=x.decisions&&typeof x.decisions==='object'?x.decisions:{};s.manual=x.manual&&typeof x.manual==='object'?x.manual:{};
 const validMonth=v=>typeof v==='string'&&date(v,true)===v;
 const validPeriod=p=>p&&typeof p==='object'&&!Array.isArray(p)&&validMonth(p.start)&&validMonth(p.end)&&p.start<=p.end&&monthRange(p.start,p.end).at(-1)===p.end;
 const validObservedDate=v=>typeof v==='string'&&(date(v)===v||validMonth(v));
 for(const i of s.imports){
  if(!i||typeof i!=='object'||Array.isArray(i))throw Error('読込履歴が不正です。');
  if(i.sourcePeriod!==undefined&&i.sourcePeriod!==null&&!validPeriod(i.sourcePeriod)||i.entity!==undefined&&typeof i.entity!=='string'||i.months!==undefined&&(!Array.isArray(i.months)||i.months.some(m=>!validMonth(m)))||['minDate','maxDate'].some(k=>i[k]!==undefined&&i[k]!==null&&!validObservedDate(i[k]))||i.minDate&&i.maxDate&&i.minDate>i.maxDate)throw Error('読込履歴の期間・事業者情報が不正です。');
  if(i.monthCounts!==undefined&&(!i.monthCounts||typeof i.monthCounts!=='object'||Array.isArray(i.monthCounts)||Object.entries(i.monthCounts).some(([m,n])=>!validMonth(m)||!Number.isSafeInteger(n)||n<0||n>100000)))throw Error('読込履歴の月別行数が不正です。');
  if(i.reportStats!==undefined){const z=i.reportStats;if(!z||typeof z!=='object'||Array.isArray(z)||z.sourcePeriod!==undefined&&z.sourcePeriod!==null&&!validPeriod(z.sourcePeriod)||z.entity!==undefined&&typeof z.entity!=='string'||['months','declaredMonths'].some(k=>z[k]!==undefined&&(!Array.isArray(z[k])||z[k].some(m=>!validMonth(m))))||z.openingMonth!==undefined&&z.openingMonth!==null&&!validMonth(z.openingMonth)||z.reportedTotals!==undefined&&(!Array.isArray(z.reportedTotals)||z.reportedTotals.some(t=>!t||['reported','calculated','difference'].some(k=>t[k]!==null&&!Number.isSafeInteger(t[k])))))throw Error('帳票の読込証拠が不正です。');}
 }
 for(const type of Object.keys(TYPES)){
   const a=x.datasets[type]??(reportType(type)?[]:undefined);if(!Array.isArray(a)||a.length>100000)throw Error('バックアップのデータが不正です。');
   for(const r of a){
     if(!r||typeof r!=='object'||Array.isArray(r))throw Error('バックアップの行データが不正です。');
     if(r.tagDimension!==undefined||r.tagValue!==undefined){if(reportType(type)!=='monthlyBS'||r.tagDimension!=='party'||typeof r.tagValue!=='string'||!r.tagValue.trim())throw Error('BSの取引先内訳情報が不正です。');}
     if(r.reportStart!==undefined||r.reportEnd!==undefined){if(!validPeriod({start:r.reportStart,end:r.reportEnd}))throw Error('帳票の対象期間情報が不正です。');}
     if(r.reportEntity!==undefined&&typeof r.reportEntity!=='string'||r.opening!==undefined&&typeof r.opening!=='boolean'||r.openingRaw!==undefined&&typeof r.openingRaw!=='string')throw Error('帳票の事業者・期首情報が不正です。');
     if(type==='current'||type==='prior'){
       if(!date(r.date)||!Number.isSafeInteger(r.debitAmount)||!Number.isSafeInteger(r.creditAmount)||typeof r.debit!=='string'||typeof r.credit!=='string')throw Error('仕訳データが不正です。金額は正確な円整数が必要です。');
       root.ReviewDetails?.validate(r);
       if(['journalId','exportNo','importSource'].some(k=>r[k]!==undefined&&typeof r[k]!=='string')||(r.journalIdKind!==undefined&&!['journal','export','row'].includes(r.journalIdKind))||(r.importErrors!==undefined&&(!Number.isInteger(r.importErrors)||r.importErrors<0))||['journalAmbiguous','metadataInherited'].some(k=>r[k]!==undefined&&typeof r[k]!=='boolean'))throw Error('仕訳のまとまり情報が不正です。');
     }
     else if(type==='balances'){if(!date(r.date,true)||!Number.isSafeInteger(r.balance)||(r.expected!==null&&!Number.isSafeInteger(r.expected)))throw Error('残高データが不正です。金額は正確な円整数が必要です。');}
     else if(type==='aging'){if(!date(r.due)||!Number.isSafeInteger(r.amount)||r.asOf&&!date(r.asOf))throw Error('期日データが不正です。金額は正確な円整数が必要です。');}
     else if(reportType(type)){
      if(!date(r.date,true)||!r.account||typeof r.account!=='string'||r.amount!==null&&!Number.isSafeInteger(r.amount)||![1,1000].includes(r.unit)||r.basis!==(reportType(type)==='monthlyPL'?'monthly':'closing')||r.statement!==undefined&&r.statement!==(reportType(type)==='monthlyPL'?'PL':'BS')||r.role&&!Object.hasOwn(root.ReviewFinancial?.roles||{},r.role))throw Error('月次帳票データが不正です。金額は正確な円整数が必要です。');
      if(r.reportedTotal!==undefined&&r.reportedTotal!==null&&!Number.isSafeInteger(r.reportedTotal)||r.reportedTotalRaw!==undefined&&typeof r.reportedTotalRaw!=='string'||r.reportedTotalMonths!==undefined&&(!Array.isArray(r.reportedTotalMonths)||r.reportedTotalMonths.some(m=>!validMonth(m))))throw Error('PLの期間累計データが不正です。');
     }
     else if(!date(r.date)||!Number.isSafeInteger(r.amount))throw Error('明細データが不正です。金額は正確な円整数が必要です。');
   }s.datasets[type]=a;
 }
 // 月次PL・BSの「表示するタグ」別の内訳（BSの取引先別は従来どおり datasets.monthlyBS/priorBS）。科目合計には足さない別の置き場。
 const tagReports=x.tagReports===undefined?[]:x.tagReports;
 if(!Array.isArray(tagReports)||tagReports.length>300000)throw Error('タグ別の帳票データが不正です。');
 for(const r of tagReports)if(!r||typeof r!=='object'||Array.isArray(r)||!['monthlyPL','monthlyBS','priorPL','priorBS'].includes(r.type)||!TAG_KEYS.includes(r.tagDimension)||reportType(r.type)==='monthlyBS'&&r.tagDimension==='party'||typeof r.tagValue!=='string'||!r.tagValue.trim()||!date(r.date,true)||typeof r.account!=='string'||!r.account||r.amount!==null&&!Number.isSafeInteger(r.amount)||![1,1000].includes(r.unit)||r.opening!==undefined&&typeof r.opening!=='boolean'||['accountCode','category','importSource','source','role'].some(k=>r[k]!==undefined&&typeof r[k]!=='string'))throw Error('タグ別の帳票データが不正です。');
 s.tagReports=tagReports;
 s.financial=root.ReviewFinancial?.validateSettings(x.financial)||s.financial;
 if(x.history){
   s.history.excludeAdjustments=x.history.excludeAdjustments!==false;
   for(const [k,v]of Object.entries(x.history.sources||{})){
     if(!k.startsWith('hsrc:')&&!k.startsWith('legacy:'))continue;
     if(!v||!['reference','confirmed','mixed','exclude'].includes(v.status))throw Error('履歴の確認状態が不正です。');
     s.history.sources[k]={name:String(v.name||'過去資料').slice(0,300),status:v.status,note:String(v.note||'').slice(0,5000)};
   }
 }
 if(x.teacher?.turns){
   if(!Array.isArray(x.teacher.turns))throw Error('先生の回答記録が不正です。');
   s.teacher.turns=x.teacher.turns.slice(-20).map(t=>{
     if(!t||typeof t.question!=='string'||typeof t.title!=='string'||!['paragraphs','steps','references'].every(k=>Array.isArray(t[k])&&t[k].every(v=>typeof v==='string')))throw Error('先生の回答記録が不正です。');
     if(['at','scope','period'].some(k=>t[k]!==undefined&&typeof t[k]!=='string'))throw Error('先生の回答記録が不正です。');
     return {...t,question:t.question.slice(0,500),paragraphs:t.paragraphs.slice(0,20),steps:t.steps.slice(0,20),references:t.references.slice(0,3)};
   });
 }
 return s;
}
root.ReviewEngine={SOURCES,CHECKS,TYPES,LABELS,parseCSV,number,monetary,date,monthRange,reportType,guessMapping,headerRow,normalizeRows,journalKey,journalGroups,journalPeriod,reportPeriod,importMapping,detectReportType,analyze,newSession,demoSession,validateSession,hash,plKind};
if(typeof module!=='undefined')module.exports=root.ReviewEngine;
})(typeof window!=='undefined'?window:globalThis);
