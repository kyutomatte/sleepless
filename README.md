# Sleepless

Sleepless is a small macOS menu bar app that helps keep a Mac awake while it is connected to AC power, even when the lid is closed.

맥북을 AC 전원에 연결해 둔 상태에서 뚜껑을 닫아도 바로 잠자기에 들어가지 않도록 돕는 Tauri 기반 macOS 앱입니다. 메뉴바의 8bit 유령 아이콘으로 빠르게 켜고 끌 수 있습니다.

## Features

- AC 전원 연결 상태에서만 awake mode를 켤 수 있습니다.
- AC 전원이 분리되면 awake mode가 조용히 자동 종료됩니다.
- 메뉴바에서 `잠자기 방지`를 체크 형태로 켜고 끌 수 있습니다.
- 닫힌 상태 유지 시간을 `10분`, `30분`, `1시간`, `영구` 중에서 고를 수 있습니다.
- 뚜껑이 닫히면 내장 디스플레이 밝기를 0으로 낮추고, 다시 열거나 모드를 끄면 이전 밝기를 복구합니다.
- 뚜껑이 닫힌 상태에서는 60초마다 배터리 안전 상태를 확인합니다.
- 배터리 사용 중 10%에 도달하면 awake mode를 자동 종료합니다.
- `AC 연결 시 자동 시작` 옵션으로 전원이 연결될 때 awake mode를 자동 시작할 수 있습니다.
- `로그인 시 백그라운드 실행` 옵션으로 macOS 로그인 시 창 없이 메뉴바에서 시작할 수 있습니다.
- 창을 닫아도 앱은 종료되지 않고 메뉴바에서 계속 제어됩니다.

## How It Works

Sleepless uses macOS power-management tools from a Tauri backend:

- `/usr/bin/pmset -g ps`로 AC 전원 상태를 확인합니다.
- 최초 1회 관리자 인증으로 작은 privileged helper를 설치합니다.
- awake mode를 켤 때 `/usr/bin/pmset -c disablesleep 1`과 `/usr/bin/caffeinate -d -i -m -s`를 사용합니다.
- awake mode를 끌 때 `/usr/bin/pmset -c disablesleep 0`으로 일반 뚜껑 닫힘 잠자기 동작을 복구하고 `caffeinate` 프로세스를 정리합니다.

macOS의 뚜껑 닫힘 잠자기는 일반 idle sleep과 다르게 동작합니다. 이 앱은 closed-lid sleep을 막기 위해 관리자 권한이 필요한 `disablesleep` 설정을 사용합니다.

## Installation

GitHub Releases에서 최신 DMG를 내려받아 설치합니다.

1. `Sleepless_0.1.0_aarch64.dmg`를 다운로드합니다.
2. DMG를 열고 `Sleepless.app`을 `Applications` 폴더로 옮깁니다.
3. 앱을 실행합니다.
4. 최초로 awake mode를 켤 때 관리자 인증을 허용합니다.

현재 제공되는 DMG는 Apple Silicon Mac용 `aarch64` 빌드입니다.

## macOS Security Notice

개인 배포 빌드는 Apple Developer ID로 서명 및 공증되지 않았을 수 있습니다. 이 경우 macOS에서 "확인되지 않은 개발자" 경고가 표시될 수 있습니다.

처음 실행이 막히면 Finder에서 앱을 우클릭한 뒤 `열기`를 선택하거나, 시스템 설정의 개인정보 보호 및 보안 화면에서 실행을 허용해야 할 수 있습니다.

## Safety And Recovery

Sleepless는 시스템 전원 설정을 변경합니다. 앱이 비정상 종료되거나 강제 종료된 뒤 닫힌 화면 잠자기 동작이 정상으로 돌아오지 않으면 아래 명령으로 직접 복구할 수 있습니다.

```bash
sudo pmset -c disablesleep 0
```

배터리 보호를 위해 다음 조건에서는 awake mode가 자동 종료됩니다.

- AC 전원이 분리된 경우
- 뚜껑이 닫힌 상태에서 배터리 상태를 안전하게 확인할 수 없는 경우
- 배터리 사용 중 잔량이 10% 이하가 된 경우
- 선택한 닫힌 상태 유지 시간이 끝난 경우

## Development

Requirements:

- macOS
- Node.js and pnpm
- Rust and Cargo

Local setup:

```bash
source "$HOME/.cargo/env"
pnpm install
pnpm test -- --run
pnpm build
pnpm tauri dev
```

Production build:

```bash
pnpm tauri build
```

Build outputs:

```text
src-tauri/target/release/bundle/macos/Sleepless.app
src-tauri/target/release/bundle/dmg/Sleepless_0.1.0_aarch64.dmg
```

## Release Checklist

Before publishing a GitHub Release:

- Run `pnpm test -- --run`.
- Run `pnpm build`.
- Run `cargo check` from `src-tauri`.
- Run `pnpm tauri build`.
- Install the generated DMG on a Mac as a fresh install.
- Test AC connected, AC disconnected, lid closed, lid opened, menu bar control, login background launch, and recovery command.
- Note whether the build is signed/notarized or unsigned.

## License

Sleepless is released under the MIT License. See [LICENSE](LICENSE) for details.
