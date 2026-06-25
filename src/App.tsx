import { useEffect, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { disable, enable, isEnabled } from "@tauri-apps/plugin-autostart";
import "./App.css";
import { useAppDispatch, useAppSelector } from "./app/hooks";
import ghostAwake from "./assets/ghost-awake.svg";
import ghostSleep from "./assets/ghost-sleep.svg";
import {
  type AwakeDuration,
  awakeStatusReceived,
  preferenceFailure,
  setAwakeDuration,
  setStartOnAcPower,
  startAwakeFailure,
  startAwakeRequest,
  startAwakeSuccess,
  stopAwakeFailure,
  stopAwakeRequest,
  stopAwakeSuccess,
  tickRuntime,
  toggleLaunchAtLogin,
  toggleStartOnAcPower,
} from "./features/awake/awakeSlice";

const START_ON_AC_POWER_KEY = "sleepless.startOnAcPower";
const AWAKE_DURATION_KEY = "sleepless.awakeDuration";
const AWAKE_DURATIONS: { value: AwakeDuration; label: string }[] = [
  { value: "10m", label: "10분" },
  { value: "30m", label: "30분" },
  { value: "1h", label: "1시간" },
  { value: "forever", label: "영구" },
];

interface AwakeStatus {
  isActive: boolean;
  isAcPowerConnected: boolean;
  awakeDuration?: AwakeDuration;
  isLidClosed?: boolean;
  batteryPercent?: number | null;
  stoppedReason?: "acDisconnected" | "durationExpired" | "batteryLow" | "batteryUnsafe";
}

function formatRuntime(seconds: number) {
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;

  if (minutes === 0) {
    return `${remainingSeconds}s`;
  }

  return `${minutes}m ${remainingSeconds.toString().padStart(2, "0")}s`;
}

function isAwakeDuration(value: string | null): value is AwakeDuration {
  return value === "10m" || value === "30m" || value === "1h" || value === "forever";
}

function App() {
  const dispatch = useAppDispatch();
  const {
    error,
    isAcPowerConnected,
    isActive,
    isBusy,
    awakeDuration,
    launchAtLogin,
    message,
    runtimeSeconds,
    startOnAcPower,
  } = useAppSelector((state) => state.awake);
  const previousAcPower = useRef<boolean | null>(null);
  const autoStartBlocked = useRef(false);
  const autoStartInFlight = useRef(false);

  useEffect(() => {
    const savedStartOnAcPower = window.localStorage.getItem(START_ON_AC_POWER_KEY);
    if (savedStartOnAcPower !== null) {
      dispatch(setStartOnAcPower(savedStartOnAcPower === "true"));
    }
    const savedAwakeDuration = window.localStorage.getItem(AWAKE_DURATION_KEY);
    if (isAwakeDuration(savedAwakeDuration)) {
      dispatch(setAwakeDuration(savedAwakeDuration));
      void invoke<AwakeStatus>("set_awake_duration", { awakeDuration: savedAwakeDuration })
        .then((status) => dispatch(awakeStatusReceived(status)))
        .catch(() => undefined);
    }

    isEnabled()
      .then((enabled) => {
        if (enabled !== launchAtLogin) {
          dispatch(toggleLaunchAtLogin());
        }
      })
      .catch(() => undefined);
  }, [dispatch]);

  useEffect(() => {
    let isCancelled = false;

    async function startFromAcPower() {
      autoStartInFlight.current = true;
      dispatch(startAwakeRequest());
      try {
        const startedStatus = await invoke<AwakeStatus>("start_awake", {
          awakeDuration,
        });
        if (!isCancelled) {
          dispatch(startAwakeSuccess(startedStatus));
        }
      } catch (caughtError) {
        autoStartBlocked.current = true;
        if (!isCancelled) {
          dispatch(startAwakeFailure(String(caughtError)));
        }
      } finally {
        autoStartInFlight.current = false;
      }
    }

    async function refreshAwakeStatus() {
      try {
        const status = await invoke<AwakeStatus>("awake_status");
        if (isCancelled) {
          return;
        }

        dispatch(awakeStatusReceived(status));

        const becameConnected = status.isAcPowerConnected && previousAcPower.current !== true;
        if (!status.isAcPowerConnected) {
          autoStartBlocked.current = false;
        }
        previousAcPower.current = status.isAcPowerConnected;

        if (
          startOnAcPower &&
          becameConnected &&
          !status.isActive &&
          !autoStartInFlight.current &&
          !autoStartBlocked.current
        ) {
          await startFromAcPower();
        }
      } catch {
        if (!isCancelled) {
          dispatch(awakeStatusReceived(false));
        }
      }
    }

    void refreshAwakeStatus();
    const timer = window.setInterval(refreshAwakeStatus, 5000);

    return () => {
      isCancelled = true;
      window.clearInterval(timer);
    };
  }, [awakeDuration, dispatch, startOnAcPower]);

  useEffect(() => {
    if (!isActive) {
      return undefined;
    }

    const timer = window.setInterval(() => {
      dispatch(tickRuntime());
    }, 1000);

    return () => window.clearInterval(timer);
  }, [dispatch, isActive]);

  useEffect(() => {
    window.localStorage.setItem(AWAKE_DURATION_KEY, awakeDuration);
  }, [awakeDuration]);

  async function toggleAwake() {
    if (isActive) {
      dispatch(stopAwakeRequest());
      try {
        await invoke<AwakeStatus>("stop_awake");
        dispatch(stopAwakeSuccess());
      } catch (caughtError) {
        dispatch(stopAwakeFailure(String(caughtError)));
      }
      return;
    }

    dispatch(startAwakeRequest());
    try {
      const status = await invoke<AwakeStatus>("start_awake", { awakeDuration });
      dispatch(startAwakeSuccess(status));
    } catch (caughtError) {
      dispatch(startAwakeFailure(String(caughtError)));
    }
  }

  async function toggleAutostart() {
    try {
      if (launchAtLogin) {
        await disable();
      } else {
        await enable();
      }
      dispatch(toggleLaunchAtLogin());
      await invoke("sync_tray_menu");
    } catch (caughtError) {
      dispatch(preferenceFailure(`Login item could not change: ${String(caughtError)}`));
    }
  }

  function toggleStartOnAcPowerSetting() {
    const nextValue = !startOnAcPower;
    window.localStorage.setItem(START_ON_AC_POWER_KEY, String(nextValue));
    dispatch(toggleStartOnAcPower());
  }

  async function changeAwakeDuration(nextDuration: AwakeDuration) {
    window.localStorage.setItem(AWAKE_DURATION_KEY, nextDuration);
    dispatch(setAwakeDuration(nextDuration));
    try {
      const status = await invoke<AwakeStatus>("set_awake_duration", {
        awakeDuration: nextDuration,
      });
      dispatch(awakeStatusReceived(status));
    } catch (caughtError) {
      dispatch(preferenceFailure(`Duration could not change: ${String(caughtError)}`));
    }
  }

  return (
    <main className="app-shell">
      <section className="awake-card" aria-live="polite">
        <header className="app-header">
          <div>
            <p className="eyebrow">AC power awake mode</p>
            <h1>Sleepless</h1>
          </div>
          <span className={isActive ? "status-chip active" : "status-chip"}>
            {isActive ? "Awake" : "Sleep"}
          </span>
        </header>

        <section className={isActive ? "hero-toggle active" : "hero-toggle"}>
          <button
            aria-pressed={isActive}
            className="ghost-switch"
            disabled={isBusy}
            onClick={toggleAwake}
            type="button"
          >
            <span className="switch-track">
              <span className="switch-knob">
                <img
                  alt={isActive ? "Awake 8bit ghost" : "Sleeping 8bit ghost"}
                  src={isActive ? ghostAwake : ghostSleep}
                />
              </span>
            </span>
            <span className="switch-copy">
              <strong>{isBusy ? "Working..." : isActive ? "눈 뜬 유령이 지키는 중" : "눈 감은 유령이 쉬는 중"}</strong>
              <small>
                {isActive
                  ? "클릭하면 awake mode를 끕니다."
                  : "관리자 인증 후 닫아도 깨어 있게 합니다."}
              </small>
            </span>
          </button>
        </section>

        <p className="status-message">{message}</p>
        {error ? <p className="error-message">{error}</p> : null}

        <section className="status-grid" aria-label="Awake details">
          <div className="detail-row">
            <span className="detail-icon plug" />
            <div>
              <strong>AC 전원</strong>
              <span>
                {isAcPowerConnected === null
                  ? "확인 중"
                  : isAcPowerConnected
                    ? "연결됨"
                    : "연결 필요"}
              </span>
            </div>
          </div>

          <div className="detail-row">
            <span className="detail-icon clock" />
            <div>
              <strong>작동 시간</strong>
              <span>{isActive ? formatRuntime(runtimeSeconds) : "대기 중"}</span>
            </div>
          </div>

          <div className="detail-row duration-row">
            <span className="detail-icon duration" />
            <div>
              <strong>닫힌 상태 유지 시간</strong>
              <span>
                {AWAKE_DURATIONS.find((duration) => duration.value === awakeDuration)?.label ??
                  "영구"}
              </span>
            </div>
            <div className="duration-segment" role="group" aria-label="Closed lid awake duration">
              {AWAKE_DURATIONS.map((duration) => (
                <button
                  aria-pressed={awakeDuration === duration.value}
                  className={awakeDuration === duration.value ? "selected" : ""}
                  key={duration.value}
                  onClick={() => {
                    void changeAwakeDuration(duration.value);
                  }}
                  type="button"
                >
                  {duration.label}
                </button>
              ))}
            </div>
          </div>

          <div className="detail-row">
            <span className="detail-icon battery" />
            <div>
              <strong>배터리 안전</strong>
              <span>
                {isActive
                  ? "닫힌 상태에서 60초마다 확인"
                  : "10% 도달 시 자동 종료"}
              </span>
            </div>
          </div>

          <label className="detail-row setting-row">
            <span className="detail-icon auto" />
            <div>
              <strong>AC 연결 시 자동 시작</strong>
              <span>{startOnAcPower ? "켜짐" : "꺼짐"}</span>
            </div>
            <input
              checked={startOnAcPower}
              onChange={toggleStartOnAcPowerSetting}
              type="checkbox"
            />
          </label>

          <label className="detail-row setting-row">
            <span className="detail-icon login" />
            <div>
              <strong>로그인 시 백그라운드 실행</strong>
              <span>{launchAtLogin ? "켜짐" : "꺼짐"}</span>
            </div>
            <input
              checked={launchAtLogin}
              onChange={toggleAutostart}
              type="checkbox"
            />
          </label>
        </section>

        <footer className="fine-print">
          Uses macOS <code>pmset disablesleep</code> with administrator permission
          and <code>caffeinate -d -i -m -s</code>.
        </footer>
      </section>
    </main>
  );
}

export default App;
