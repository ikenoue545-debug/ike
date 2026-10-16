"""標準の勘定科目表：科目名から BS/PL・区分・税務上の分類を推定する。

推定は「候補」で、利用者が確認・修正できる。科目名だけで課税関係を確定しない（交際費などは
税務調整の候補を出すだけで、内訳の確認を求める）。
"""
from __future__ import annotations

import re
import unicodedata
from typing import Optional

SECTIONS = {'asset': '資産', 'liability': '負債', 'equity': '純資産', 'revenue': '収益', 'expense': '費用'}
STATEMENT_OF = {'asset': 'BS', 'liability': 'BS', 'equity': 'BS', 'revenue': 'PL', 'expense': 'PL'}
DEBIT_NORMAL = {'asset', 'expense'}

CATEGORIES: dict[str, tuple[str, str]] = {
    # key: (区分, 表示名)
    'cash': ('asset', '現金・預金'),
    'receivable': ('asset', '売上債権'),
    'inventory': ('asset', '棚卸資産'),
    'prepaid': ('asset', '前払費用'),
    'suspense_payment': ('asset', '仮払金・立替金'),
    'suspense_tax': ('asset', '仮払税金'),
    'refund_receivable': ('asset', '未収還付法人税等'),
    'consumption_tax_paid': ('asset', '仮払消費税等'),
    'other_current_asset': ('asset', 'その他の流動資産'),
    'tangible_fixed_asset': ('asset', '有形固定資産'),
    'accumulated_depreciation': ('asset', '減価償却累計額'),
    'intangible_asset': ('asset', '無形固定資産'),
    'investment': ('asset', '投資その他の資産'),
    'deferred_asset': ('asset', '繰延資産'),
    'allowance_bad_debt': ('asset', '貸倒引当金'),
    'payable': ('liability', '仕入債務・未払金'),
    'accrued_expense': ('liability', '未払費用'),
    'income_taxes_payable': ('liability', '未払法人税等'),
    'consumption_tax_payable': ('liability', '未払消費税等'),
    'withholding_payable': ('liability', '預り金'),
    'borrowing': ('liability', '借入金'),
    'officer_borrowing': ('liability', '役員借入金'),
    'other_liability': ('liability', 'その他の負債'),
    'capital': ('equity', '資本金'),
    'capital_reserve': ('equity', '資本準備金'),
    'other_capital_surplus': ('equity', 'その他資本剰余金'),
    'legal_reserve': ('equity', '利益準備金'),
    'voluntary_reserve': ('equity', '任意積立金'),
    'retained_earnings': ('equity', '繰越利益剰余金'),
    'treasury_stock': ('equity', '自己株式'),
    'sales': ('revenue', '売上高'),
    'interest_income': ('revenue', '受取利息'),
    'dividend_income': ('revenue', '受取配当金'),
    'misc_income': ('revenue', '雑収入'),
    'gain_on_sale': ('revenue', '固定資産売却益'),
    'other_revenue': ('revenue', 'その他の収益'),
    'cogs': ('expense', '売上原価'),
    'officer_compensation': ('expense', '役員報酬'),
    'officer_bonus': ('expense', '役員賞与'),
    'salaries': ('expense', '給与・賞与'),
    'entertainment': ('expense', '交際費'),
    'meeting': ('expense', '会議費'),
    'donations': ('expense', '寄附金'),
    'taxes_and_dues': ('expense', '租税公課'),
    'depreciation': ('expense', '減価償却費'),
    'bad_debt': ('expense', '貸倒損失・貸倒引当金繰入'),
    'interest_expense': ('expense', '支払利息'),
    'penalties': ('expense', '罰金・科料'),
    'loss_on_sale': ('expense', '固定資産売却損・除却損'),
    'corporate_taxes': ('expense', '法人税、住民税及び事業税'),
    'deferred_taxes': ('expense', '法人税等調整額'),
    'other_expense': ('expense', 'その他の費用'),
}

# 科目名（正規化後）→ 分類
_NAMES: dict[str, str] = {}


def _reg(category: str, *names: str) -> None:
    for n in names:
        _NAMES[normalize(n)] = category


def normalize(name: str) -> str:
    s = unicodedata.normalize('NFKC', name or '').strip()
    s = re.sub(r'\s+', '', s)
    return s.replace('・', '').replace('、', '').replace('，', '').replace(',', '')


_reg('cash', '現金', '小口現金', '普通預金', '当座預金', '定期預金', '定期積金', '通知預金', '別段預金', '外貨預金', '現金及び預金')
_reg('receivable', '売掛金', '受取手形', '電子記録債権', '未収入金', '未収金', '未収収益', 'クレジット売掛金')
_reg('inventory', '商品', '製品', '仕掛品', '原材料', '貯蔵品', '半製品', '未成工事支出金')
_reg('prepaid', '前払費用', '前払金', '前渡金')
_reg('suspense_payment', '仮払金', '立替金', '短期貸付金', '役員貸付金', '従業員貸付金')
_reg('suspense_tax', '仮払税金', '仮払法人税等', '仮払法人税', '仮払住民税', '仮払事業税', '仮払源泉税', '仮払源泉所得税')
_reg('refund_receivable', '未収還付法人税等', '未収法人税等')
_reg('consumption_tax_paid', '仮払消費税', '仮払消費税等')
_reg('other_current_asset', 'その他流動資産', '前払消費税', '未収消費税等')
_reg('tangible_fixed_asset', '建物', '建物附属設備', '附属設備', '構築物', '機械装置', '機械及び装置', '車両運搬具', '工具器具備品',
     '工具器具及び備品', '器具備品', '一括償却資産', '土地', '建設仮勘定', 'リース資産')
_reg('accumulated_depreciation', '減価償却累計額', '建物減価償却累計額', '車両運搬具減価償却累計額', '工具器具備品減価償却累計額')
_reg('intangible_asset', 'ソフトウェア', 'のれん', '電話加入権', '商標権', '特許権')
_reg('investment', '投資有価証券', '出資金', '関係会社株式', '敷金', '差入保証金', '保証金', '長期貸付金', '保険積立金',
     '長期前払費用', '倒産防止共済掛金', '長期性預金')
_reg('deferred_asset', '創立費', '開業費', '開発費', '株式交付費')
_reg('allowance_bad_debt', '貸倒引当金')
_reg('payable', '買掛金', '支払手形', '未払金', '電子記録債務', 'クレジットカード', '未払配当金')
_reg('accrued_expense', '未払費用', '未払給与', '賞与引当金', '前受金', '前受収益', '仮受金')
_reg('income_taxes_payable', '未払法人税等', '未払法人税', '未払法人税住民税及び事業税', '未払法人税住民税等')
_reg('consumption_tax_payable', '未払消費税', '未払消費税等', '仮受消費税', '仮受消費税等')
_reg('withholding_payable', '預り金', '預かり金', '源泉所得税預り金', '社会保険料預り金', '住民税預り金')
_reg('borrowing', '短期借入金', '長期借入金', '1年以内返済長期借入金')
_reg('officer_borrowing', '役員借入金')
_reg('capital', '資本金', '出資金（資本）')
_reg('capital_reserve', '資本準備金')
_reg('other_capital_surplus', 'その他資本剰余金', '資本剰余金')
_reg('legal_reserve', '利益準備金')
_reg('voluntary_reserve', '別途積立金', '任意積立金', '圧縮積立金', '特別償却準備金')
_reg('retained_earnings', '繰越利益剰余金', '繰越利益', '利益剰余金', 'その他利益剰余金')
_reg('treasury_stock', '自己株式')
_reg('sales', '売上高', '売上', '役務収益', '完成工事高', '売上値引高', '売上戻り高')
_reg('interest_income', '受取利息', '受取利息配当金', '有価証券利息')
_reg('dividend_income', '受取配当金', '受取配当')
_reg('misc_income', '雑収入', '雑収益', '受取手数料', '受取家賃', '助成金収入', '補助金収入', '保険差益')
_reg('gain_on_sale', '固定資産売却益', '投資有価証券売却益')
_reg('other_revenue', '前期損益修正益', '貸倒引当金戻入', '貸倒引当金戻入額', '償却債権取立益')
_reg('cogs', '仕入高', '仕入', '期首商品棚卸高', '期末商品棚卸高', '商品仕入高', '外注加工費', '材料費', '労務費', '製造経費', '売上原価')
_reg('officer_compensation', '役員報酬', '役員給与')
_reg('officer_bonus', '役員賞与')
_reg('salaries', '給料手当', '給料', '給与手当', '賃金', '賞与', '雑給', '退職金', '退職給付費用', '賞与引当金繰入額')
_reg('entertainment', '交際費', '接待交際費', '交際接待費')
_reg('meeting', '会議費')
_reg('donations', '寄付金', '寄附金')
_reg('taxes_and_dues', '租税公課')
_reg('depreciation', '減価償却費', '少額減価償却資産', '一括償却資産償却', '繰延資産償却', '長期前払費用償却')
_reg('bad_debt', '貸倒損失', '貸倒引当金繰入', '貸倒引当金繰入額')
_reg('interest_expense', '支払利息', '支払利息割引料')
_reg('penalties', '罰金', '罰金科料', '交通反則金')
_reg('loss_on_sale', '固定資産売却損', '固定資産除却損', '投資有価証券売却損')
_reg('corporate_taxes', '法人税住民税及び事業税', '法人税等', '法人税住民税事業税', '法人税及び住民税', '法人税住民税及び事業税等')
_reg('deferred_taxes', '法人税等調整額')
_reg('other_expense', '法定福利費', '福利厚生費', '外注費', '広告宣伝費', '販売促進費', '旅費交通費', '通信費', '消耗品費',
     '事務用品費', '水道光熱費', '地代家賃', '賃借料', '支払手数料', '支払報酬', '支払報酬料', '保険料', '修繕費', '荷造運賃',
     '新聞図書費', '諸会費', '研修費', '教育研修費', '車両費', '燃料費', 'リース料', '雑費', '雑損失', '支払保険料', '採用教育費',
     '前期損益修正損', '為替差損', '支払家賃', '会費', '寄付金以外', 'ソフトウェア利用料', '業務委託料', '外注委託費')

# 見出し行（freee などの試算表にある分類の行）→ 区分
HEADINGS: list[tuple[str, str]] = [
    ('資産', 'asset'), ('流動資産', 'asset'), ('固定資産', 'asset'), ('有形固定資産', 'asset'), ('無形固定資産', 'asset'),
    ('投資その他の資産', 'asset'), ('繰延資産', 'asset'), ('負債', 'liability'), ('流動負債', 'liability'),
    ('固定負債', 'liability'), ('純資産', 'equity'), ('資本', 'equity'), ('株主資本', 'equity'), ('利益剰余金', 'equity'),
    ('資本剰余金', 'equity'), ('売上高', 'revenue'), ('営業外収益', 'revenue'), ('特別利益', 'revenue'),
    ('売上原価', 'expense'), ('販売管理費', 'expense'), ('販売費及び一般管理費', 'expense'), ('営業外費用', 'expense'),
    ('特別損失', 'expense'), ('法人税等', 'expense'), ('製造原価', 'expense'),
]


def heading_section(label: str) -> Optional[str]:
    s = normalize(label).replace('の部', '')
    s = re.sub(r'(合計|計)$', '', s)
    for name, sec in HEADINGS:
        if s == normalize(name):
            return sec
    return None


def classify(name: str, heading: Optional[str] = None) -> dict:
    """科目名（と取込時の見出し）から区分・分類を推定する。"""
    n = normalize(name)
    cat = _NAMES.get(n)
    if cat is None:
        # 「〇〇減価償却累計額」など語尾で推定
        for suffix, c in (('減価償却累計額', 'accumulated_depreciation'), ('預金', 'cash'), ('引当金繰入額', 'other_expense'),
                          ('引当金', 'accrued_expense'), ('積立金', 'voluntary_reserve'), ('借入金', 'borrowing')):
            if n.endswith(suffix):
                cat = c
                break
    if cat is not None:
        section = CATEGORIES[cat][0]
        return {'section': section, 'statement': STATEMENT_OF[section], 'category': cat, 'classification': 'auto'}
    hs = heading_section(heading) if heading else None
    if hs is not None:
        cat = {'asset': 'other_current_asset', 'liability': 'other_liability', 'equity': None,
               'revenue': 'other_revenue', 'expense': 'other_expense'}[hs]
        return {'section': hs, 'statement': STATEMENT_OF[hs], 'category': cat,
                'classification': 'auto' if cat else 'unknown'}
    return {'section': None, 'statement': None, 'category': None, 'classification': 'unknown'}


def category_options() -> list[dict]:
    return [{'key': k, 'section': s, 'section_label': SECTIONS[s], 'label': l} for k, (s, l) in CATEGORIES.items()]
