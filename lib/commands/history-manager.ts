import type { ICommand } from './type'

/**
 * 历史管理器：管理撤销/重做操作的命令栈
 */
class HistoryManager {
  private _maxHistorySize: number
  private _undoStack: ICommand[] = []
  private _redoStack: ICommand[] = []

  /**
   * 执行命令并记录到历史
   * 用于需要执行+记录的场景（如从外部触发的命令）
   */
  executeCommand (command: ICommand): void {
    command.execute()
    this.addCommand(command)
  }

  /**
   * 将已执行的命令添加到历史记录
   * 用于实时绘制场景（命令已经通过其他方式执行完成）
   */
  addCommand (command: ICommand): void {
    // 清空重做栈（因为执行了新命令，重做历史失效）
    this._redoStack = []

    // 尝试合并命令（如果可能的话）
    const lastCommand = this._undoStack[this._undoStack.length - 1]
    if (lastCommand && lastCommand.canMerge?.(command) && lastCommand.merge) {
      const mergedCommand = lastCommand.merge(command) ?? lastCommand
      if (mergedCommand !== lastCommand) {
        this._undoStack[this._undoStack.length - 1] = mergedCommand
      }
      return
    }

    // 添加到撤销栈
    this._undoStack.push(command)

    // 限制历史大小
    if (this._undoStack.length > this._maxHistorySize) {
      this._undoStack.shift()
    }
  }

  /**
   * 撤销操作
   */
  undo (): ICommand | null {
    if (this._undoStack.length === 0) {
      return null
    }

    const command = this._undoStack.pop()!
    command.undo()

    // 将撤销的命令推入重做栈
    this._redoStack.push(command)

    return command
  }

  /**
   * 重做操作
   */
  redo (): ICommand | null {
    if (this._redoStack.length === 0) {
      return null
    }

    const command = this._redoStack.pop()!
    command.execute()

    // 将重做的命令推入撤销栈
    this._undoStack.push(command)

    return command
  }

  /**
   * 检查是否可以撤销
   */
  canUndo (): boolean {
    return this._undoStack.length > 0
  }

  /**
   * 检查是否可以重做
   */
  canRedo (): boolean {
    return this._redoStack.length > 0
  }

  /**
   * 清空所有历史
   */
  clear (): void {
    this._undoStack = []
    this._redoStack = []
  }

  /**
   * 设置最大历史大小
   */
  setMaxHistorySize (size: number): void {
    this._maxHistorySize = Math.max(1, size)

    // 如果当前撤销栈超过新限制，删除旧的命令
    if (this._undoStack.length > this._maxHistorySize) {
      this._undoStack = this._undoStack.slice(-this._maxHistorySize)
    }
  }

  constructor (options?: {
    /**
     * Maximum number of commands to keep in history.
     *
     * @default 50
     */
    maxHistorySize?: number

    /**
     * You can optionally provide initial undo and redo stacks.
     * This is useful in some situations like loading from a saved state,
     * or already having a Vue reactive array to use.
     *
     * @default []
     */
    undoStack?: ICommand[]

    /**
     * You can optionally provide initial undo and redo stacks.
     * This is useful in some situations like loading from a saved state,
     * or already having a Vue reactive array to use.
     *
     * @default []
     */
    redoStack?: ICommand[]
  }) {
    this._maxHistorySize = options?.maxHistorySize ?? 50
    this._undoStack = options?.undoStack ?? []
    this._redoStack = options?.redoStack ?? []
  }
}

export {
  HistoryManager
}
