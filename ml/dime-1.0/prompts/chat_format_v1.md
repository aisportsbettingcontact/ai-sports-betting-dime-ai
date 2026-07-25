# Dime Llama 3 Chat Format v1

The parent is a Base checkpoint, so Dime owns and versions its chat format.

Each message is rendered as:

```text
<|start_header_id|>{role}<|end_header_id|>

{content}<|eot_id|>
```

The sequence begins with `<|begin_of_text|>`. Valid roles are `system`, `user`,
`assistant`, and `tool`.

Tool calls are canonical compact JSON wrapped in:

```text
<tool_call>{"id":"...","type":"function","function":{...}}</tool_call>
```

Tool results are rendered in a `tool` message. JSON keys are sorted and no
insignificant whitespace is retained.

The release artifact serializes the executable Jinja form at
`prompts/llama3_dime_chat_template_v1.jinja`. Tool results preserve both
`tool_call_id` and tool `name`, so parallel calls cannot be silently
misassociated. Training and inference both inject the same versioned, read-only
tool catalog.

During SFT, labels are `-100` for the system, user, tool, and all role headers.
Only assistant content and its final `<|eot_id|>` token are supervised. Records
that exceed the configured context length are rejected and reported; the final
answer is never silently truncated.
