"""法人番号の検査、本店所在地からの都道府県・市区町村の抽出、申告期限。"""
from __future__ import annotations

import re
import unicodedata
from typing import Optional

PREFECTURES = ['北海道', '青森県', '岩手県', '宮城県', '秋田県', '山形県', '福島県', '茨城県', '栃木県', '群馬県', '埼玉県', '千葉県',
               '東京都', '神奈川県', '新潟県', '富山県', '石川県', '福井県', '山梨県', '長野県', '岐阜県', '静岡県', '愛知県', '三重県',
               '滋賀県', '京都府', '大阪府', '兵庫県', '奈良県', '和歌山県', '鳥取県', '島根県', '岡山県', '広島県', '山口県', '徳島県',
               '香川県', '愛媛県', '高知県', '福岡県', '佐賀県', '長崎県', '熊本県', '大分県', '宮崎県', '鹿児島県', '沖縄県']
# 名前の途中に「市」を含む市（最初の「市」で切ると誤る）
_CITY_EXCEPTIONS = ['四日市市', '廿日市市', '野々市市', '市川市', '市原市', '市貝町', '市川三郷町']


def check_corporate_number(number: str) -> tuple[bool, str]:
    """法人番号（13桁）の検査用数字を確かめる。
    検査用数字 ＝ 9 −（Σ Pn × Qn を9で割った余り）。Pn は基礎番号（下12桁）の下からn桁目、Qn は n が奇数なら1、偶数なら2。
    （行政手続における特定の個人を識別するための番号の利用等に関する法律に基づく法人番号の検査用数字の計算方法）"""
    s = unicodedata.normalize('NFKC', number or '').replace('-', '').strip()
    if not re.fullmatch(r'\d{13}', s):
        return False, '法人番号は13桁の数字です'
    base = s[1:]
    total = sum(int(d) * (1 if n % 2 == 1 else 2) for n, d in enumerate(reversed(base), start=1))
    check = 9 - total % 9
    if check != int(s[0]):
        return False, '法人番号の検査用数字が合いません（入力間違いの可能性があります）'
    return True, ''


def split_address(address: str) -> dict[str, Optional[str]]:
    """本店所在地から都道府県と市区町村（地方税の申告先の候補）を取り出す。候補なので利用者が確認する。"""
    a = unicodedata.normalize('NFKC', address or '').replace(' ', '').replace('　', '')
    pref = next((p for p in PREFECTURES if a.startswith(p)), None)
    if pref is None:
        return {'prefecture': None, 'municipality': None}
    rest = a[len(pref):]
    for ex in _CITY_EXCEPTIONS:
        if rest.startswith(ex):
            return {'prefecture': pref, 'municipality': ex}
    gun = rest.find('郡')
    idx = [i for i in (rest.find('市'), rest.find('区')) if 0 < i <= 6]
    if idx and (gun < 0 or min(idx) < gun):
        return {'prefecture': pref, 'municipality': rest[:min(idx) + 1]}
    if 0 < gun <= 6:
        m = re.match(r'^(.+?郡.+?[町村])', rest)
        if m:
            return {'prefecture': pref, 'municipality': m.group(1)}
    m = re.match(r'^(.{1,6}?[町村])', rest)
    return {'prefecture': pref, 'municipality': m.group(1) if m else None}


def local_tax_candidates(prefecture: Optional[str], municipality: Optional[str]) -> list[dict]:
    """地方税の申告先の候補。東京都23区は都が市町村民税相当分も課税する。"""
    if not prefecture:
        return []
    out = [{'kind': '道府県民税・事業税', 'office': f'{prefecture}（本店所在地の都道府県税事務所）'}]
    if prefecture == '東京都' and municipality and municipality.endswith('区'):
        out[0]['kind'] = '都民税（道府県民税・市町村民税相当分）・事業税'
        out[0]['note'] = '特別区（23区）の区域は、都が法人都民税を一括して課税します'
    elif municipality:
        out.append({'kind': '市町村民税', 'office': municipality})
    return out
