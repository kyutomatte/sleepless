# Sleepless

AC 전원에 연결된 동안 macOS가 시스템 잠자기에 들어가지 않도록 돕는 Tauri 데스크톱 앱입니다.

## 동작 방식

- 앱에서 `잠자기 방지`를 켜면 Tauri 백엔드가 최초 1회 관리자 인증으로 작은 power helper를 설치한 뒤 `/usr/bin/pmset -c disablesleep 1`과 `/usr/bin/caffeinate -d -i -m -s`를 실행합니다.
- 시작 전에 `/usr/bin/pmset -g ps`로 AC 전원 상태를 확인합니다.
- `잠자기 방지`를 끄면 설치된 helper가 추가 인증 없이 `/usr/bin/pmset -c disablesleep 0`으로 일반 뚜껑 닫힘 잠자기 동작을 복구하고, 실행 중인 `caffeinate` 프로세스를 정리합니다.
- AC 전원이 분리되면 백그라운드 전원 감시 루프가 조용히 awake mode를 끕니다.
- `AC 연결 시 자동 시작` 토글을 켜면 AC 전원이 다시 연결될 때 awake mode를 자동으로 시작합니다.
- 뚜껑이 닫히면 내장 디스플레이 밝기를 0으로 낮추고, 뚜껑을 열거나 모드를 끄면 이전 밝기를 복구합니다.
- 뚜껑이 닫힌 상태에서는 60초마다 배터리 상태를 확인하고, 배터리가 10% 이하가 되거나 상태를 읽을 수 없으면 awake mode를 끄고 잠자기로 전환합니다.
- 닫힌 상태 유지 시간은 10분, 30분, 1시간, 영구 중에서 선택할 수 있으며 앱 UI와 메뉴바 메뉴에 모두 반영됩니다.
- 메뉴바에 8bit 유령 심볼을 고정하고, 한국어 메뉴에서 창 열기/잠자기 방지 체크/유지 시간/종료를 실행할 수 있습니다.
- 창 닫기 버튼은 앱을 종료하지 않고 창만 숨기며, 메뉴바에서 계속 제어할 수 있습니다.
- `로그인 시 백그라운드 실행` 토글은 Tauri autostart 플러그인으로 macOS 로그인 항목에 연결되며, 로그인 때는 창을 띄우지 않고 메뉴바에서만 시작합니다.
- 앱 아이콘과 메뉴바 심볼은 눈 뜬 유령/눈 감은 유령 상태를 사용합니다.

macOS의 뚜껑 닫힘 동작은 일반 idle sleep과 다릅니다. 이 앱은 AC 전원 조건에서 closed-lid sleep을 막기 위해 관리자 권한이 필요한 `disablesleep` 설정을 사용합니다. 최초 helper 설치 이후 켜기/끄기는 추가 인증 없이 동작합니다. 앱이 비정상 종료되거나 강제 종료되면 `pmset -c disablesleep 0`으로 직접 복구해야 할 수 있습니다.

```bash
sudo pmset -c disablesleep 0
```

## 개발

이 환경에서는 번들 pnpm과 Rust를 사용했습니다.

```bash
source "$HOME/.cargo/env"
pnpm install
pnpm test -- --run
pnpm build
pnpm tauri dev
```

## 빌드 산출물

```text
src-tauri/target/release/bundle/macos/Sleepless.app
src-tauri/target/release/bundle/dmg/Sleepless_0.1.0_aarch64.dmg
```
