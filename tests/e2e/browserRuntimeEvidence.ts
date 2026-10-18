/**
 * 纯函数：把 Playwright 项目配置与浏览器运行时信息整理成可严格核查的证据对象。
 *
 * 背景（Playwright 1.63 已确认）：
 *   `BrowserType.executablePath()` 返回的是 registry 里的**预期安装位置**，
 *   它**不反映**显式 `launchOptions.executablePath`。因此在显式 pin 的场景下，
 *   继续把默认 API 的值当 actual 会造成重复/误导的 revision。
 *
 * 规则：
 *   - `launchOptions.executablePath` 为非空字符串 -> 原样使用，
 *     标记 `executablePathSource: 'launchOptions-configured'`，且**绝不调用**
 *     registry 默认 API；
 *   - `launchOptions.executablePath === undefined` -> 取 registry 默认 API，
 *     标记 `executablePathSource: 'registry-default-expected'`；
 *   - 空串或非字符串类型 -> 抛错，**不静默 fallback**（避免把默认值伪装成配置值）。
 *
 * 该字段是**配置证据，不是 OS 进程观测**；下游做 canonical pin 核查时必须按此理解。
 */

export type ExecutablePathSource =
  'launchOptions-configured' | 'registry-default-expected';

export type LaunchOptionsLike = {
  executablePath?: unknown;
};

export type BrowserRuntimeEvidenceInput = {
  browserName: string;
  version: string;
  launchOptions: LaunchOptionsLike | undefined;
  /**
   * 对应 `project.use.channel`。branded channel 会自行解析二进制位置，因此记录的
   * `executablePath` 未必是实际启动的本地二进制。
   */
  channel?: unknown;
  /**
   * 对应 `project.use.connectOptions != null`。连接远程浏览器时，记录的
   * `executablePath` 不是本地 actual。
   */
  hasConnectOptions?: boolean;
  /**
   * registry 默认 API（即 `browser.browserType().executablePath()`）。
   * 仅在显式配置缺失时被调用。
   */
  readRegistryExecutablePath: () => string;
};

export type BrowserRuntimeEvidence = {
  browserName: string;
  executablePath: string;
  executablePathSource: ExecutablePathSource;
  version: string;
  /** 显式声明：这是配置证据，不是 OS 进程观测。 */
  executablePathObservation: 'configured-not-os-process-observed';
  /** 保守边界标注，不扩展平台逻辑。 */
  executablePathCaveats: string[];
};

export function resolveBrowserRuntimeEvidence(
  input: BrowserRuntimeEvidenceInput,
): BrowserRuntimeEvidence {
  const configured = input.launchOptions?.executablePath;
  let executablePath: string;
  let executablePathSource: ExecutablePathSource;

  if (configured === undefined) {
    // 仅“未配置”才落到 registry 预期默认值。
    executablePath = input.readRegistryExecutablePath();
    executablePathSource = 'registry-default-expected';
  } else if (typeof configured === 'string' && configured.length > 0) {
    // 显式配置优先，且不触碰 registry 默认 API。
    executablePath = configured;
    executablePathSource = 'launchOptions-configured';
  } else {
    // 空串 / 错误类型：显式失败，绝不静默 fallback。
    throw new TypeError(
      'launchOptions.executablePath must be a non-empty string when configured',
    );
  }

  const executablePathCaveats: string[] = [];
  if (typeof input.channel === 'string' && input.channel.length > 0)
    executablePathCaveats.push(
      'channel-configured: executablePath may not be the actual local binary the channel launches',
    );
  if (input.hasConnectOptions === true)
    executablePathCaveats.push(
      'connect-configured: remote browser; executablePath is not a local process observation',
    );

  return {
    browserName: input.browserName,
    executablePath,
    executablePathSource,
    version: input.version,
    executablePathObservation: 'configured-not-os-process-observed',
    executablePathCaveats,
  };
}
