---
title: Sample naming rules
ms.date: 01/02/2026
---

# Sample naming rules

> [!NOTE]
> | not | a | rules | row |

## Microsoft.Sample

> [!div class="mx-tableFixed"]
> | Entity | Scope | Length | Valid Characters |
> | --- | --- | --- | --- |
> | servers | resource group | 3-63 | Lowercase letters and numbers<br><br>Start with a lowercase letter. |
> | servers / databases | servers | 1-128 | Can't use:<br>`<>*%&:\/?|` or control characters<br><br>Can't end with period or space. |
> | defaults | servers | 7 | Must be `default`. |

## Microsoft.Other (preview)

> [!div class="mx-tableFixed"]
> | Entity | Scope | Length | Valid Characters |
> | --- | --- | --- | --- |
> | servers | global | 3-63 | Lowercase letters, hyphens, and numbers<br><br>Can't start or end with hyphen. |
> | stores\* | global | 5-50 | Alphanumerics and hyphens<br><br>Can't contain a sequence of more than two hyphens. |
> | stores / replicas | stores | 1-50<br><br>The combined length can't exceed 60 characters.| Alphanumerics |
> | machines | resource group | 1-15 (Windows)<br>1-64 (Linux) | Volume can't be named `bin`. |

\* footnote text

## Next steps

- nothing here
