# Security review — Motion P0.3 + R4 Security-Hardened

実装者自身による敵対的レビューです。安全性の保証・証明・第三者監査の代替ではありません。全コード、PNG全画素、仕様、salt/nonce/header/checkpoint、複数セッションと一部既知平文を攻撃者が持ち、秘密はpassphraseだけとします（Kerckhoffs's principle）。RD画像の解析が完全に成功し、ECC後のpacketまで回収された場合も想定します。

## 安全性を支える仮定とRDの位置づけ

PBKDF2の候補試行コスト、HKDFの鍵分離、HMAC-SHA256のPRF/認証仮定、SHA256の衝突耐性、CSPRNG、十分なpassword entropyおよび実装の正しさに依存します。標準プリミティブ採用だけから全プロトコルの安全性を結論しません。

Reaction-Diffusionそのものの未知性や複雑性を、暗号学的安全性の唯一の根拠にはしていません。RDはstate evolution / carrier generation / chained state contributionに利用します。K_carrierが隠れていることも本文秘密性の追加保証として数えません。攻撃者が係数を完全回収しても、公開header、暗号文、MAC、checkpoint digestを得る段階に留めるのが設計意図です。HMACから鍵列を予測できないことと、認証により不正な遷移を受理しないことが重要です。

## Findings（統合版に残るもの・この作業で修正したもの）

### High H1 — 弱い合い言葉のoffline検証（成立）

- 位置: core.js `master`, `readHeader`, `checkpointTag`, `decodeSheets`。
- 条件: 可視初回frameを取得し、候補passwordを列挙できる。
- 手順: 公開5 lanesを一度読んでsalt/nonce/header/tagを回収。候補ごとにPBKDF2とK_checkpointだけを導出してheader MACと比較。
- 影響: RD進化なしでpasswordを検証できる。弱いpasswordを得れば全文を復号できる。
- 再現: tests/crypto-attacks.cjs のheader-only dictionary attack。旧P0.3はバンドルaudit/tests/header-guess.cjsでも保存画像から実行。
- 最小対策: 独立に生成した十分な長さの合い言葉を用いる。今後Argon2idの実装・配布を監査してmemory-hard KDF profileを追加。公開検証tagを削るだけではciphertext/MACによる辞書攻撃を解消しない。
- 互換性: password運用は非破壊。KDF変更は新magic/profileが必要。

実装の候補試験は1 PBKDF2（600,000 HMAC）+ HKDF extract1 +5鍵expand5 +検証MAC1相当。攻撃者はCHECKPOINTだけをexpandでき、最適化時は合計600,003 HMAC相当（HMACの内部SHA圧縮回数とは異なる）。測定はローカルNode CPUのみ。2026年のGPU/ASICの試行速度は実測していないため数値を創作しない。PBKDF2はmemory-hardではなく並列候補試験に弱い。[OWASPの現行指針](https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html)はArgon2idを推奨し、PBKDF2-HMAC-SHA256では600,000回以上を示すが、これが弱いpasswordを救うという意味ではない。

### Medium M1 — 完全なcontext再利用で鍵列が再利用（条件付き成立）

- 位置: core.js `context`, `expand`, `encodeBytes`。
- 条件: 同じK_stream、session、sheet/index/length、prior digestを再利用。RNG故障・復元された実行状態などを仮定する。
- 手順: 同じcontextから得るSは同一。C1 XOR P1 XOR C2で同位置のP2が得られる。
- 影響: 再利用した区間の秘密性が失われる。これは全プロトコルが通常動作で破れるという実証ではない。
- 再現: tests/crypto-attacks.cjs。100 fresh sessions試験は100個の鍵列contextであり100画像生成ではない。saltだけ/nonceだけの再利用では別session/鍵になることを検査。
- 最小修正/対策: 本版は独立128-bit salt/nonce、production override禁止。双方再利用へのmisuse resistanceは主張しない。追加するなら独立永続session counter等の要件・状態管理を設計する。
- 互換性: 外部entropy override廃止はR3呼出API非互換。永続counter導入はprofile変更。

P0.2では双方再利用時に実初期RDから96bytesの既知平文復元を実証した（別audit）。本版は初回本文0で、全文MACも初回RDへ入り、異なる本文間で同じ後続stateになる実証はない。前digestの衝突を仮定しても異なるframe indexでは鍵列は変わる。

### Medium M2 — 圧縮長・frame数の漏洩（成立する条件あり）

- 位置: motion-payload.js `pack`, core.js公開header、transport.js。
- 条件: ファイル/公開headerを観測。さらに攻撃者入力と秘密を同じ本文へ連結して繰返し生成する外部運用。
- 手順: 候補文字列の一致で圧縮長が変わるか比較する。長さはheaderに明示され、APNGサイズでも近似できる。
- 影響: 本文長や反復性、条件付きで秘密候補を絞れる。UI自体には未知の秘密を自動混入する機能はない。
- 再現: audit/tests/compression-oracle.cjs はtoy co-compressionで1byte差を実証。実UIから未知秘密を盗む攻撃は未実証。
- 最小対策: 攻撃者入力と秘密の同時圧縮を避ける。必要なら長さpaddingを新設計。
- 互換性: 運用変更は互換。paddingはwrapper/profile変更と容量損失。

### Low L1 — JS鍵消去と一定時間比較の限界

- 位置: core.js `wipe`, `hmacKeys`, `eq`; app.js password input; worker.js。
- 条件: 同一originの悪性script、拡張機能、メモリ検査など通常の暗号ファイル攻撃より強いアクセス。
- 手順: password文字列やWebCrypto内部鍵のコピーを観測する。
- 影響: JSのzero-fillで過去コピーを完全消去できない。ループ比較もJITレベルの一定時間を証明していない。
- 再現/評価: 静的データフロー確認のみ。メモリ抽出攻撃の実験は未実施。
- 最小対策: Worker終了・外部script排除・端末保護。機密処理用の専用環境を別途検討。
- 互換性: コンテナ形式への影響なし。

### Low L2 — 同じ正当な動画の全体replayを検出しない

- 位置: transport.js `decode`, core.js `decodeSheets`。
- 条件: 過去の完全に正当な画像一式と合い言葉を再使用。
- 手順: 同じ一式を再度渡す。
- 影響: 再度同じ本文が返る。フレームsplice/欠損拒否とは別問題。
- 再現: 保存画像の繰返し復号試験が同じ結果を返す。
- 最小対策: アプリ外で受信済みsessionを記録。画像+passwordだけのstateless復号では既読状態を判断できない。
- 互換性: 外部状態の追加は現要件との調整が必要。

### Medium F1 — 旧P0.2/P0.3の表示改変・parser曖昧性（統合版で修正）

- 位置: 旧apng.js `decode`、旧core.js `decodeSheets`。統合版の同名関数が修正先。
- 条件/手順: 中間表示frameを黒へ置換して有効CRC/deflateを作る。またはsequence/control/CRC/終端を変更。
- 影響: 旧版は暗号本文が同じでも違う動画を受理する。P0.2/P0.3で実際に成立。
- 再現: audit/tests/apng-attacks.cjs、統合版tests/apng-attacks.cjs。
- 最小修正: PNG構造を厳密化、全表示rasterを認証済みpacketから再生成・照合。本版に実装。
- 互換性: 旧曖昧ファイル、画素劣化、規格上有効でも別APNG構成を拒否。R4専用profileも別。

### Low F2 — ZIP local/central headerの不一致（統合時に修正）

- 位置: R3 zip.js `read`、統合版zip.js `read`。
- 条件/手順: central CRC/sizeを保ちlocal CRC/sizeを変更。以前のreaderはcentralのみを信頼するため別ツールとの解釈差を残す。
- 影響: parser差。これだけで本文改ざん認証を突破したとは確認していない。
- 再現: tests/zip-bounds.cjs（最終版の拒否試験）。旧R3での動的攻撃は未実施。
- 最小修正: 両headerのflags/method/CRC/size/name一致、非重複の順次領域、単一diskのみ。実装済み。
- 互換性: data descriptor付きなど、このwriterが作らないZIPを拒否。PNG単体には影響なし。

## 項目別の再監査

- KDF/HKDF: saltはPBKDF2、nonceはHKDF extractとsessionへ使う。5つのinfo文字列が異なる。[RFC5869](https://www.rfc-editor.org/rfc/rfc5869.html)のextract/expandをWebCryptoへ依頼。異なる鍵値を数学的に絶対保証するわけではなく、意図的な同一鍵利用を排除する。
- Context: 固定幅session/index/length/digest/counter、固定domain。HMACを用いるため素のSHA256 secret-prefixのlength-extensionは該当しない。公開carrier定数は秘密鍵ではない。
- HMAC stream: global indexとsheet/count/nonceをbind。stateが同じだけでは他indexの鍵列は同じにならない。known/chosen plaintextの単純XOR外挿試験は他indexを復元しなかった。一般的な攻撃不存在の証明ではない。
- Authentication: headerとmini-header、ciphertext、prior state、session、全長、count、sheet情報をbind。frameMAC前にXORしない。全文検証前に外へ平文を返さない。検証前の画像処理・ECCにはCPU負荷が残る。
- RD chaining: 攻撃者が画像を作っても、frameMACを通らなければ次RDへ採用されない。checkpointは実prior digestと一致させる。checkpointから独立再始動する経路を持たない。sheet境界にも同じ規則。state digest collisionそのものは発見していない。
- Bootstrap: 公開情報はmagic、salt/nonce、packed長/count、全文MAC、headerMAC、span。平文bodyはない。公開MACはoffline oracleになる。初回の私有laneはframeMACを運ぶ。
- Randomness: productionの秘密乱数はgetRandomValuesのみ。HMAC出力を32-bit単位で取り出す箇所はrejection sampling用であり、鍵全体の32-bit化ではない。乱数取得失敗は例外で停止。deterministic overrideは拒否。test-only exportsは明示RDSTREAM_TESTINGフラグで限定、productionで設定しない。
- JS: Q20値をFloat64Arrayへ格納し演算は整数へ丸める。状態canonical化はendian明示。sliceでU/V入力を複製し、表示採取は不変。HMAC cacheはkey object identity、同一job内だけに依存。Workerは一度に1job。PNG/ZIP/展開に上限。ただし最大入力でのメモリ/実行時間の負荷試験は未実施。

## 結論と第三者へ渡す事項

実際に成立したものは弱passwordのoffline判定、完全context再利用時のXOR復元、条件付き圧縮長oracle、旧版の表示・parser改変受理です。統合版に対し今回の試験で未認証の平文を返す攻撃は得られていません。

理論上の懸念で未実証なのはHMAC/ SHAの破壊、実用的state衝突、双方nonce/salt再利用時の異なる本文間の統合版state一致、未知ブラウザ差、全規模のDoS、JSメモリ残留攻撃です。

既知のPRF/衝突耐性仮定の下で、鍵分離・固定幅domain・frame/全体MACのbindingに具体的な破り方は見つけていません。これは独自構成全体の形式的還元証明ではありません。

優先事項: 強いpassphrase、第三者による全プロトコル/実装監査、Argon2id導入評価、実ブラウザ間の決定性・大容量メモリ試験、美観の再改善。次の修正後は全roundtrip、改変/混入、parser上限、実state依存、表示採取不変、画像再圧縮を再試験してください。第三者向けの簡潔なwire/crypto仕様はPROTOCOL.md、R3差分監査はバンドルaudit/R3_AUDIT.mdです。
