# Référence des layouts clavier Windows

## Qu'est-ce qu'un HKL ?

Un **HKL** (Handle to Keyboard Layout) est un identifiant 32 bits représentant une disposition de clavier installée. Il est représenté en hexadécimal sur 8 caractères.

Les 16 bits de poids faible correspondent au **LCID** (Locale Identifier) et les 16 bits de poids fort au **layout ID** physique. Pour la majorité des cas simples, HKL = `0000` + LCID.

## Codes HKL courants

| Code HKL     | Layout                       |
| ------------ | ---------------------------- |
| `00000409`   | Anglais US (QWERTY)          |
| `0000040C`   | Français (France) AZERTY     |
| `0000080C`   | Français (Belgique) AZERTY   |
| `00000813`   | Néerlandais (Belgique)       |
| `00000407`   | Allemand QWERTZ              |
| `00000410`   | Italien QWERTY               |
| `0000040A`   | Espagnol (Espagne)           |
| `00000809`   | Anglais (Royaume-Uni)        |
| `00000411`   | Japonais                     |
| `00000419`   | Russe                        |
| `00000416`   | Portugais (Brésil)           |
| `00000816`   | Portugais (Portugal)         |
| `0000041D`   | Suédois                      |
| `00000406`   | Danois                       |
| `00000414`   | Norvégien                    |
| `0000040B`   | Finnois                      |

## Lister les layouts installés depuis la registry

Windows stocke tous les layouts installés dans la clé :

```
HKEY_LOCAL_MACHINE\SYSTEM\CurrentControlSet\Control\Keyboard Layouts
```

Chaque sous-clé est nommée avec le code HKL (8 caractères hexadécimaux) et contient notamment la valeur `Layout Text` (nom affiché par Windows).

### Depuis PowerShell

```powershell
Get-ChildItem 'HKLM:\SYSTEM\CurrentControlSet\Control\Keyboard Layouts' |
  ForEach-Object {
    $name = $_.PSChildName
    $text = (Get-ItemProperty $_.PSPath).'Layout Text'
    [PSCustomObject]@{ HKL = $name; Name = $text }
  } | Sort-Object HKL
```

### Depuis cmd

```cmd
reg query "HKLM\SYSTEM\CurrentControlSet\Control\Keyboard Layouts" /s /v "Layout Text"
```

### Depuis Node (via un module tiers ou child_process)

On peut exécuter la commande PowerShell ci-dessus via `child_process.exec` et parser le JSON retourné si on ajoute `| ConvertTo-Json`.

## Lister les layouts actuellement chargés (runtime)

Les layouts installés ne sont pas forcément tous **chargés** dans la session courante. L'API Win32 `GetKeyboardLayoutList` retourne uniquement les HKL actifs pour l'utilisateur courant.

```js
// Via koffi
const count = user32.GetKeyboardLayoutList(0, null);
const buffer = new Array(count);
user32.GetKeyboardLayoutList(count, buffer);
```

Pour rendre un layout disponible, il faut l'ajouter via **Paramètres Windows → Heure et langue → Langue et région → Options de la langue**, ou le charger dynamiquement avec `LoadKeyboardLayoutW("<HKL>", KLF_ACTIVATE)`.

## Ressources

- [Microsoft — Default Input Locales for Windows Language Packs](https://learn.microsoft.com/en-us/windows-hardware/manufacture/desktop/default-input-locales-for-windows-language-packs)
- [Microsoft — LoadKeyboardLayoutW](https://learn.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-loadkeyboardlayoutw)
- [Microsoft — GetKeyboardLayoutList](https://learn.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-getkeyboardlayoutlist)
