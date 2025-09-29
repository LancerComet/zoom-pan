import type { ICommand } from './type'

/**
 * 历史管理器：管理撤销/重做操作的命令栈
 */
class HistoryManager {
  private _maxHistorySize: number

  undoStack: ICommand[] = []
  redoStack: ICommand[] = []

  /**
   * 执行命令并记录到历史
   */
  executeCommand (command: ICommand): void {
    // 执行命令
    command.execute()

    // 清空重做栈（因为执行了新命令，重做历史失效）
    this.redoStack = []

    // 尝试合并命令（如果可能的话）
    const lastCommand = this.undoStack[this.undoStack.length - 1]
    if (lastCommand && lastCommand.canMerge?.(command) && lastCommand.merge) {
      const mergedCommand = lastCommand.merge(command) ?? lastCommand
      if (mergedCommand !== lastCommand) {
        this.undoStack[this.undoStack.length - 1] = mergedCommand
      }
      return
    }

    // 添加到撤销栈
    this.undoStack.push(command)

    // 限制历史大小
    if (this.undoStack.length > this._maxHistorySize) {
      this.undoStack.shift()
    }
  }

  /**
   * 撤销操作
   */
  undo (): ICommand | null {
    if (this.undoStack.length === 0) {
      return null
    }

    const command = this.undoStack.pop()!
    command.undo()

    // 将撤销的命令推入重做栈
    this.redoStack.push(command)

    return command
  }

  /**
   * 重做操作
   */
  redo (): ICommand | null {
    if (this.redoStack.length === 0) {
      return null
    }

    const command = this.redoStack.pop()!
    command.execute()

    // 将重做的命令推入撤销栈
    this.undoStack.push(command)

    return command
  }

  /**
   * 检查是否可以撤销
   */
  canUndo (): boolean {
    return this.undoStack.length > 0
  }

  /**
   * 检查是否可以重做
   */
  canRedo (): boolean {
    return this.redoStack.length > 0
  }

  /**
   * 清空所有历史
   */
  clear (): void {
    this.undoStack = []
    this.redoStack = []
  }

  /**
   * 设置最大历史大小
   */
  setMaxHistorySize (size: number): void {
    this._maxHistorySize = Math.max(1, size)

    // 如果当前撤销栈超过新限制，删除旧的命令
    if (this.undoStack.length > this._maxHistorySize) {
      this.undoStack = this.undoStack.slice(-this._maxHistorySize)
    }
  }

  constructor (maxHistorySize = 50) {
    this._maxHistorySize = maxHistorySize
  }
}

export {
  HistoryManager
}
