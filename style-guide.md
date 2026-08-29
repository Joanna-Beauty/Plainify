# Urbanist UI Style Guide

本文件根據參考圖像整理出 UI 設計語言，供 wireframe 套用與日後延伸。數值以 8px 節奏為基準（6/8/12/16/24/32）。

## 字體（Typography）
- 字體家族：Urbanist（Google Fonts），支援 Regular / Medium / Bold
- 文字大小：
  - Heading 2：36px（行高 44–48）
  - Sub‑heading：24px（行高 32）
  - Body：20px（行高 28–32）
  - Label / Meta：12–14px、顏色偏灰
- 風格特徵：幾何無襯線、略緊字距、標題粗、正文中等重量；強調點使用 Bold。

## 色彩（Palette）
- 主色（Primary）：Eerie Black `#212121`（文字/主按鈕/選中狀態）
- 背景（App BG）：Ghost White `#F6F5FA`
- 內容面（Surface）：White `#FFFFFF`
- 輔助/柔和底色（Pastel Accents）：
  - Alice Blue `#DBDFE9`
  - Honeydew `#CFDECA`
  - Vanilla `#EFF0A3`
- 線條與分隔（Line）：`#E6E6EA`（1px）
- 提示文字（Muted）：`#6A6A6A`

## 卡片與按鈕（Radius / Shadow / Spacing）
- 圓角：
  - 卡片：16px–20px
  - 按鈕/輸入框：12px–14px
  - 膠囊（Tab/Chip）：999px
- 陰影（柔和、低對比）：
  - 卡片/面板：`0 1px 2px rgba(0,0,0,0.04), 0 8px 24px rgba(33,33,33,0.06)`
  - 主按鈕：`0 4px 12px rgba(0,0,0,0.16)`
- 邊距：以 8px 為單位；卡片內距 16px，區塊間距 16–24px。

## 排版與留白（Layout）
- 以卡片化資訊模組組成，卡片間留白 12–16px。
- 內容區最大寬度 480–720px（行動優先），頁面背景使用淺灰白，卡片使用純白。
- 錨定元件（頂/底工具列）有淡分隔線與輕微投影，避免壓迫感。

## 元件樣式（Components）
- Tabs（膠囊）：
  - 預設：白底 + 1px 淺灰描邊 + 中灰字。
  - 選中：黑底 `#212121` + 白字；可加輕投影。
- Button：
  - Primary：黑底白字、14px 圓角、內距 10–14px、Medium/Bold 字重。
  - Secondary（Ghost/Outline）：白底、1px 灰邊、黑字，hover 加淡背景。
  - 重要操作可搭配柔和底色（Vanilla/Honeydew）做區分。
- Input / Select / Textarea：白底、1px 灰邊、14px 圓角；focus 2px 外框（黑或粉彩重點色）。
- Label / Chip：小字、灰色，膠囊形，邊框 1px，填色可用淡粉彩。
- Card：白底、16px 圓角、柔和陰影，可用 Pastel 作背景塊或圖表底色。

## 響應式（Responsive）
- 行動優先；在 ≥640px 放大標題與卡片內距。
- 文字大小可用 clamp() 於 16–20px 間自適應；標題 24–36px。

## 可用性（States）
- Focus：2px 外框（黑或 `#EFF0A3`），offset 0–2px。
- Hover：按鈕提亮或投影加深；Tab 選中保持高對比。

