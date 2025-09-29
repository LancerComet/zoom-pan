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
  canMerge? (other: ICommand): boolean {
    if (other) {
      return false
    }
    return false
  }

  /**
   * 合并两个兼容的命令
   */
  merge? (other: ICommand): ICommand {
    return other
  }

  /**
   * 获取命令的描述信息，用于UI显示
   */
  getDescription? (): string {
    return 'Unknown operation'
  }

  /**
   * 获取命令的时间戳
   */
  getTimestamp (): number {
    return this.timestamp
  }
}

export { BaseCommand }
