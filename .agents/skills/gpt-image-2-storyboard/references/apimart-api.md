# APIMart GPT-Image-2 接口

最后核实日期：2026-07-14。

## 通用

- 地址：`POST https://api.apimart.ai/v1/images/generations`
- 异步返回 `task_id`，使用 `GET /v1/tasks/{task_id}` 查询。
- 完成后立即下载结果到本地，不长期依赖临时 URL。
- 本地参考图先上传到 `POST /v1/uploads/images`。

## 官方通道

- 模型：`gpt-image-2-official`
- 支持文生图、`image_urls` 图生图、`mask_url` 局部重绘。
- `size` 支持比例或像素尺寸，`resolution` 为 `1k|2k|4k`。
- `quality` 为 `auto|low|medium|high`，单次 `n` 最多 4。
- 透明背景会被降级，不要承诺透明输出。

## 常规通道

- 模型：`gpt-image-2`
- 支持文生图和最多 16 张 `image_urls` 参考图。
- `size` 支持 15 种比例，`resolution` 为 `1k|2k|4k`，单次 `n` 最多 10。
- `response_format` 和 `style` 会被忽略，不要传入。

来源：

- https://docs.apimart.ai/cn/api-reference/images/gpt-image-2/generation
- https://docs.apimart.ai/cn/api-reference/images/gpt-image-2/official

## 工作台额外生图模型

- Nano Banana：`gemini-2.5-flash-image-preview-official`，通用生图接口，仅 1K、单张，最多 14 张参考图。
- Seedream 5.0 Pro：`doubao-seedream-5-0-pro`，通用生图接口，1K/2K、单张，最多 10 张参考图。
- Midjourney：模型标识 `midjourney`，提交到 `POST /v1/midjourney/generations`；默认一组四宫格，使用 `speed`、`version` 和 `style`，不传 `resolution` 或 `n`。

来源：

- https://docs.apimart.ai/en/api-reference/images/gemini-2.5-flash/generation
- https://docs.apimart.ai/en/api-reference/images/seedream-5-0-pro/generation
- https://docs.apimart.ai/en/api-reference/images/midjourney/imagine
