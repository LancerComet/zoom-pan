import type { ICommand } from './type'

/**
 * 基础命令类，提供默认实现和通用功能
 */
abstract class BaseCommand implements ICommand {
  readonly type: ICommand['type']
  protected timestamp: number

  protected constructor (type: ICommand['type']) {
    this.type = type
    this.timestamp = Date.now()
  }

  abstract execute (): void
  abstract undo (): void

  /**
   * 判断两个命令是否可以合并（例如连续的笔画操作）
   */
  abstract canMerge? (other: ICommand): boolean

  /**
   * 合并两个兼容的命令
   */
  abstract merge? (other: ICommand): ICommand

  /**
   * 获取命令的时间戳
   */
  getTimestamp (): number {
    return this.timestamp
  }
}

export {
  BaseCommand
}
