# @actovia-ai/secret-detect

Find and mask secrets in field names, URLs and command lines. Plain
TypeScript with no dependencies; it runs in Node and in a browser alike, so a
server and its UI judge a value by the same rules.

```ts
import {
  argsHoldSecret,
  isSecretName,
  maskMcpArgs,
  maskMcpUrl,
  maskSecret
} from '@actovia-ai/secret-detect'

isSecretName('OPENAI_API_KEY') // true
isSecretName('keyboardLayout') // false: judged word by word
maskSecret('sk-abcdefghijklmnop') // '•••• mnop'
maskMcpUrl('https://user:pw@host/sse?token=abc123') // userinfo and token masked
maskMcpArgs(['--api-key', 'sk-abcdefghijklmnop']) // ['--api-key', '•••• mnop']
argsHoldSecret(['-H', 'Authorization: Bearer abc']) // true
```

| Export                                                                                        | What it does                                                                                                                                                                                                                                                                              |
| --------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `isSecretName(name)`                                                                          | The name holds a secret word (`key`, `secret`, `password`, `token`, `auth`, `bearer`, `credential`, `cookie`, `session`, `pat`), judged word by word in any case style. Look-alikes (`path`, `author`, `keyboard`) and a short allowlist (`max-tokens`, `session-timeout`…) do not count. |
| `maskSecret(value)`                                                                           | `'•••• ' + last4` for 12 characters or more, `'••••'` below, `null` for unset                                                                                                                                                                                                             |
| `maskMcpUrl(url)`                                                                             | Masks a URL's userinfo, its secret-named query values and capability-looking path segments                                                                                                                                                                                                |
| `maskMcpArgs(args)` / `scanArgs(args)` / `argsHoldSecret(args)`                               | Masks, lists or detects the secrets in a command line: a value after a secret flag (`--token x`, `--api-key=x`, `-p x`), an `Authorization:` header value, `NAME=value` with a secret name. Any value under a secret flag counts, including one made only of digits.                      |
| `MASK_BULLETS`, `MASK_TOKEN`, `AUTH_SCHEME`, `URL_PARTS`, `isCapabilitySegment`, `safeDecode` | The pieces underneath                                                                                                                                                                                                                                                                     |

MIT.
