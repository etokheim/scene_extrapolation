---
name: home-assistant-templates
description: >-
  Home Assistant Jinja templating quirks, type conversion, YAML quoting, and
  safe patterns for automations/scripts/template entities. Use when writing or
  debugging value_template, Jinja in automations.yaml, templates.yaml, scripts,
  blueprints, template sensors/helpers, or any HA {{ }} / {% %} template.
---

# Home Assistant templates

Official docs (prefer over memory): [Templating](https://www.home-assistant.io/docs/templating/), especially [Types](https://www.home-assistant.io/docs/templating/types/), [States](https://www.home-assistant.io/docs/templating/states/), [YAML](https://www.home-assistant.io/docs/templating/yaml/), [Errors](https://www.home-assistant.io/docs/templating/errors/).

## Must-follow rules

1. **Every `states('…')` is a string** — even numeric sensors. Convert before math/compare: `| float(0)` / `| int(0)` with a default.
2. **Prefer `states('entity.id')` over `states.entity.id.state`** — missing entities error with dotted access; the function returns `'unknown'`.
3. **`state_attr` can be `None`** — always `| float(0)` / `| int(0)` / `| bool(false)` (or guard with `is not none`).
4. **Never treat bare template variables as booleans** if they came from a rendered `variables:` action — `"False"` is a non-empty string → truthy. Prefer inlining the expression, or coerce with `| bool(false)`.
5. **`map` / `select` / `reject` / `*attr` return iterables** — append `| list` before `| count`, `| length`, indexing, or reuse.
6. **Quote single-line templates in YAML**; use `>-` / `|` for multi-line. Prefer `>-` for `value_template`.

## High-frequency gotchas

| Trap | Why | Fix |
|------|-----|-----|
| `states('sensor.x') + 1` | str + int | `\| float(0) + 1` |
| `'6' > '10'` | lexical compare | cast both sides to float/int |
| `unavailable` / `unknown` in math | conversion fails | default on float/int, or `has_value` / `is_number` first |
| `{% if my_var %}` after `my_var: '{{ false }}'` | string `"False"` is truthy | inline, or `my_var \| bool(false)` |
| `is true` on a state | states are strings; `"true" is true` is false | `\| bool` or `is_state(..., 'on')` |
| `\| count` after `\| map` | iterable not list | `\| list \| count` |
| Sorting/expand by `.state` numerically | state is text | `\| map(attribute='state') \| map('float') \| list` (and filter unavailable) |

## Safe patterns

```jinja
{# Light / scene state #}
{{ states('light.ceiling_lights') }}
{{ is_state('scene.stue_dag', 'on') }}

{# Guard before math (numeric sensors) #}
{% if states('sensor.power') | is_number %}
  {{ states('sensor.power') | float * 0.25 }}
{% endif %}

{# Availability #}
{% if has_value('light.ceiling_lights') %}
  {{ state_attr('light.ceiling_lights', 'brightness') | int(0) }}
{% endif %}

{# Boolean from on/off entity #}
{{ is_state('input_boolean.nightlights', 'on') }}
{{ states('input_boolean.nightlights') | bool(false) }}
```

```yaml
# Prefer multi-line for non-trivial conditions
value_template: >-
  {{
    is_state('light.ceiling_lights', 'on')
    or is_state('input_boolean.nightlights', 'on')
  }}
```

Automation/script `variables:` — store numbers with `| float(0)` at assignment; **recompute booleans in the condition** (or `| bool`) instead of `{% if flag %}`.

## Debugging here

- Developer Tools → Template in the **sandbox** UI (`http://localhost:8123`) when available.
- REST `POST /api/template` via [`.cursor/skills/home-assistant-api/SKILL.md`](../home-assistant-api/SKILL.md).
- Automation traces: `dev/config/.storage/trace.saved_traces` → `changed_variables` on steps (do not dump auth blobs; see secrets-handling).
- `| typeof` is for debugging types, not production logic.

## Maintain this skill (required)

When you discover a new HA template quirk (failed template, surprising truthiness, YAML parse issue, limited-template restriction, version-specific change):

1. Add a concise row/bullet here in the same change set as the fix.
2. Prefer linking to official docs over restating long explanations.
3. Do not duplicate into `AGENTS.md` — keep that file a pointer only.
4. If official docs contradict this skill, update the skill to match docs and note the HA version if behavior is version-gated.
