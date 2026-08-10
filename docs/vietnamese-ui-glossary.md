# Vietnamese UI glossary

This is the approved terminology baseline for the `vi` dictionaries. It is
source-controlled so every product area uses the same language. A native
Vietnamese reviewer must approve additions or changes before they are used in
release UI.

| English      | Vietnamese    | Guidance                                                       |
| ------------ | ------------- | -------------------------------------------------------------- |
| File         | Tệp           | Use in menus and messages.                                     |
| Save         | Lưu           | Use **Lưu thành…** for “Save As”.                              |
| Document     | Tài liệu      | Includes the Docs product and generic documents.               |
| Workbook     | Sổ làm việc   | Sheets context only.                                           |
| Worksheet    | Trang tính    | Sheets context only.                                           |
| Slide        | Trang chiếu   | Slides context only.                                           |
| Presentation | Bản trình bày | Use for a deck or presentation workflow.                       |
| Ribbon       | Dải lệnh      | Use only when naming the control.                              |
| Settings     | Cài đặt       | Do not mix with “Thiết lập” without a contextual reason.       |
| Undo         | Hoàn tác      | Keep shortcut labels unchanged.                                |
| Redo         | Làm lại       | Keep shortcut labels unchanged.                                |
| AI assistant | Trợ lý AI     | Retain the familiar “AI” abbreviation.                         |
| Sync         | Đồng bộ       | Use **Đồng bộ ngay** for an explicit action.                   |
| Open         | Mở            | Use **Mở tệp** when the object needs to be explicit.           |
| Close        | Đóng          | Use for tabs, dialogs, and windows.                            |
| Delete       | Xóa           | Use **Chuyển vào Thùng rác** when the behavior is recoverable. |
| Cancel       | Hủy           | Use consistently in dialogs.                                   |
| Apply        | Áp dụng       | Use for a reversible formatting or settings action.            |
| Export       | Xuất          | Preserve the target format or extension.                       |
| Print        | In            | Use **In…** when it opens a dialog.                            |

## Translation rules

- Preserve placeholders such as `{name}`, `{count}`, `{reason}`, keyboard
  shortcuts, file extensions, product names, model names, code, and MIME types.
- Prefer concise, professional Vietnamese. Shorten labels deliberately rather
  than clipping or using unexplained English.
- Translate AI preset prompts as instructions in Vietnamese. The AI fallback
  directive is separate and must remain in the locale providers.
- Do not change spreadsheet formula syntax as part of UI localization.

## Inventory command

Run `npm run --silent i18n:inventory` to produce a JSON list of every English source
key, grouped by dictionary shard. This output is the handoff artifact for the
translator and the parity-review checklist for the `vi` dictionaries.
