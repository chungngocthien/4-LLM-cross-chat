# Execution Contract V4.1 — Mock Run Artifacts

## Mục đích

Bộ 4 file này là artifact vật lý cho **mock run đầu tiên** của Pipeline V4.1.
Mục tiêu: kiểm tra xem một LLM lạnh (chưa từng nói chuyện về bài toán) có đọc `mock_contract.md` và hiểu đúng pain point, đề xuất representation hợp lý, sinh code đúng ngôn ngữ (TypeScript cho Repo 1 — Electron) — mà không cần prompt thêm hay không.

Nguyên tắc cốt lõi (từ ChatGPT, được GLM đồng thuận): **Pipeline tích lũy representation, không tích lũy ý tưởng.** Contract này là representation đầu tiên được kiểm chứng.

## File

| File | Vai trò |
|---|---|
| `mock_contract.md` | Engineering Artifact — bounty `BTY-2026-0717-01 / context_drift_auditor`. Đây là file nạp cho LLM lạnh. |
| `contract.schema.json` | Machine-readable schema cho Metadata Block. Document of record. |
| `validate.js` | Node script — đọc .md → parse frontmatter → validate theo schema → in OK/FAIL. Zero runtime deps. |
| `README.md` | File này. |

## Cách chạy validate

```bash
cd /home/z/my-project/contracts
node validate.js                       # validates mock_contract.md
node validate.js path/to/other.md      # validates other file
```

Exit codes:
- `0` — pass
- `1` — validation error (in ra danh sách lỗi)
- `2` — file not found

## Cách chạy cold LLM comprehension test (β — user-side, confirm cuối)

1. Mở một cửa sổ ChatGPT / Claude / Gemini **mới** — chưa từng nói chuyện về "context drift" hay "Repo 1".
2. Paste toàn bộ nội dung `mock_contract.md` vào. **Không thêm gì khác.**
3. Quan sát kết quả:
   - **Pass** — LLM tự hiểu pain point, tự đề xuất representation, tự sinh code TypeScript mà không hỏi lại.
   - **Fail** — LLM hỏi "bạn muốn tôi làm gì?", bỏ sót Metadata Block, hiểu sai pain point, hoặc sinh code sai ngôn ngữ (vd. Rust).
4. Ghi lại đoạn hội thoại để iterate contract (tối đa 2 vòng, sau đó đóng mock run).

## Phạm vi (KHÔNG bao gồm — để giữ mock run tối thiểu)

- Rust workspace / crate / cargo (Repo 1 là Electron, không phải Rust)
- Layer 1 (Research Question Gen), Layer 2 (crawl thật), Layer 2.5 (Abstraction Extraction — chỉ có placeholder field `ABSTRACTION_HASH` / `PAIN_CLUSTER_ID`)
- Multi-LLM orchestrator thật (§3 chỉ là gợi ý vai trò, không phải implementation)
- Telemetry shipper, snapshot/hash reproducibility, Discord/GitHub crawler
- Scoring formula thật (số trong mock contract là hardcoded)
- ASSET_CLASS taxonomy đầy đủ (mock dùng 1 giá trị `B2B_CORE_LICENSE`)

## Anti-complacency checkpoint

Hai câu hỏi mở dưới đây **KHÔNG ĐƯỢC ĐÓNG** cho đến khi bounty thật #1 chạy hết vòng đời:

1. Mock run đã trả lời được Q2/Q3/Q7 của pipeline chưa? Cụ thể bounty thật đầu tiên phải probe những gì mock không cover?
2. LLM lạnh đọc contract có hiểu đúng không? Nếu không, field nào gây hiểu nhầm?

## Phiên bản

- **V4.1** — Thêm `ABSTRACTION_HASH` / `PAIN_CLUSTER_ID` placeholder cho Layer 2.5 (chưa implement logic). Tách parser/validator thành 2 trách nhiệm riêng. Đổi `PRIMARY_STACK` từ `RUST` sang `TYPESCRIPT` để khớp thực tế Repo 1 (Electron).
- **V4** — Bản gốc (Stable Core / Evolution Layer).
