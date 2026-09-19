# 第三者監査用・統合R4プロトコル仕様

本仕様はこのフォルダのcore.js/organic.js/transform.js/tables.js/apng.jsに対応します。別profileとは互換性がありません。UTF-8 passwordは不正UTF-16を拒否し、Unicode正規化は行いません。整数は記載がなければunsigned 32-bit big-endianです。

## 鍵とdomain

salt=S:16、nonce=N:16をそれぞれgetRandomValuesで生成。M=PBKDF2-HMAC-SHA256(UTF8(password), S, 600000, 32 bytes)。HKDF-SHA256はIKM=M, salt=N, info=UTF8(`TURING-RDSTREAM-R4/MOTION-P0.3/`+NAME), output32。NAMEはSTREAM/AUTH/CARRIER/STATE/CHECKPOINT。masterはimport後に元byte列をzero-fillしますがWebCrypto内部の鍵消去を保証しません。

以下D(label)=UTF8(`TURING-RDSTREAM-R4/MOTION-P0.3/`+label+NUL)。用途別HMACのメッセージは固定domainと固定幅フィールドおよび最後の可変長bodyです。整数counterは0始まり。可変長文字列の曖昧な連結はありません。

## 入力・header

raw上限131072 bytes。RDM1ラッパー12 bytes: magic `52 44 4d 31`, version byte1, compression byte0または1, reserved2=0, raw length u32。bodyはrawまたはdeflate。短い場合のみ圧縮。packed上限131084 bytes。

初回header Hは160 bytes:

|offset|length|内容|
|---:|---:|---|
|0|4|magic/profile `52 44 04 06`|
|4|16|salt|
|20|16|nonce|
|36|4|packed length|
|40|4|global index=0|
|44|4|total information frames|
|48|32|zero初期checkpoint|
|80|32|whole-message MAC|
|112|32|header/checkpoint MAC|
|144|4|sheet span（8または128）|
|148|12|reserved zero|

session=H[0:40]||H[44:48]||H[144:148]（48 bytes）。追加の隠しsession IDはなく、このsalt/nonceを含む固定識別子がbindされます。total countはpacked lengthとcapacity関数から一意に計算し照合。sheet context SC(i)=u32(floor(i/span))||u32(ceil(count/span))。

通常のmini-headerは16 bytes: magic4||index4||count4||reserved4=0。i>0かつi mod8=0では80 bytesとし、16:48へ直前RD digest、48:80へsync checkpoint MAC。初回payload容量0、通常144、checkpoint80。

## 閉ループ

U/Vは512²、Q=2^20の整数値、範囲0..Q。Float64Arrayへ格納するが、毎演算段階に`floor(x/divisor+0.5)`とclampを適用。canonical stateはrow-major順にU,Vを交互にsigned int32 little-endianで書いた2,097,152 bytes。digest=SHA256(canonical state)。floatの生バイトをhashしない。正規化したdigestは状態そのものへの暗号学的commitmentとして扱い、秘密エントロピーとして数えない。

初期seedはK_stateのHMAC counter: D(STATE-RESTART)||session||u32(0)||zero32||u32(block)。65536 bytesを生成しorganic.initialへ渡す。以降はcheckpoint/sheet境界でも状態をリセットしない。

フレームi、capacity nの鍵列block b:
`HMAC(K_stream, D(STREAM-BLOCK)||session||SC(i)||u32(i)||u32(n)||prior_digest||u32(b))`。
必要なn bytesへ切り詰め、zero-padding済み平文n bytesとXORしてCとする。

- whole MAC: HMAC(K_auth, D(MESSAGE-MAC)||session||packed_data)
- header MAC: HMAC(K_checkpoint, D(CHECKPOINT-MAC)||H[0:112]||H[144:160])
- sync MAC: HMAC(K_checkpoint, D(SYNC-CHECKPOINT-MAC)||session||SC(i)||mini[0:48])
- frame MAC: HMAC(K_auth, D(FRAME-MAC)||session||SC(i)||header||prior_digest||C)

すべて32 bytes。packet=header||C||frameMAC=192 bytes。MAC比較は長さ一致後に全byte XOR/OR。JSエンジンが厳密な一定時間動作を保証するわけではない。

## 可視carrierとRD

packetを32 bytes×6 lanesに分け、GF(256), polynomial0x11d, roots alpha^0..31のRS(64,32)へ。各64 bytesをK9、octal557/663、8 zero-tail、rate1/2の畳み込み符号へ（1040 bits/lane）。合計6240 bitsを1..79の全画面DCTモード6241個から選ぶ。

公開layoutはSHA256(D(PUBLIC-CARRIER))を公開HMAC鍵としたD(PUBLIC-LAYOUT) counterによるshuffle/sign。初回の最初5 RS lanesのみ公開配置。残り初回1laneと全後続laneはK_carrier、D(PRIVATE-LAYOUT)||session||u32(i)||counterでshuffle/sign。rejection samplingでmodulo biasを回避する。carrier鍵を32-bitへ縮退させない。

coeffは符号±45000、逆変換は同梱整数FFT/table。この全画面field Eが局所注入およびGray–Scott反応条件へ入る。D_u=.18、D_v=.09、feed=.029、基準feed+kill=.0845、forcing15/10000。初期800、各情報フレーム1600 steps。周期境界。描画はVの分位点と整数tanh近似から濃淡10..245へ写像し、画素への追加payload書込はない。

初回の全文MACもRD生成条件に入るため、同一salt+nonceでも異なる本文が単純に最初の有データframeの同じstateへ進むとは限らない。これはnonce misuse耐性の証明ではない。完全に同じkey/context/stateでの再利用は必ず同じ鍵列になる。

## ファイルと受理条件

各physical sheetは先頭情報状態1枚＋間の実進化状態。local information count mに対してstride=max(1,ceil(119/max(1,m-1)))、visual count=1+(m-1)*stride。途中採取のみでfinal stateは不変。各画像のdelay総和5000ms、loop1。m=1の末尾sheetは5秒静止1frameとなる。sheet間に表示用補間はないが暗号U/Vは連続。

512×512 8-bit grayscale PNG、IHDR/acTL/fcTL/IDAT/fdAT/IENDのみ。APNGの制御値はこのprofileへ固定。CRC、bounds、sequence、終端、制御を検査。全frameを展開上限内で読む。PNG filter0..4受理。1画像160MiB、全画像512MiB、最大32画像。PNGはCRCが有効でも暗号認証ではない。

復号は画像入力順のまま、初回公開headerでcount/spanを決定。認証済みpacketのみで次状態を計算。frameMAC前にbodyをXORしない。全表示frameを同じRDから再生成しbyte一致を要求。全padding zeroを要求し全文MAC後にbytesを返し、さらにラッパー展開してUIへ返す。MAC・画像・入力異常で平文をUIへ公開しない。エラーの種類は区別され、headerのoffline guessing oracleは存在する。
