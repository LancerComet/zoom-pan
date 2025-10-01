type CommandType = 'stroke' | string

// Undo/Redo system types
interface ICommand {
  readonly type: CommandType
  execute(): void
  undo(): void
  canMerge?(other: ICommand): boolean
  merge?(other: ICommand): ICommand
}

interface IStrokePoint {
  x: number
  y: number
  pressure: number
}

interface IStrokeData {
  points: IStrokePoint[]
  color: string
  size: number
  mode: 'brush' | 'eraser'
}

export type {
  CommandType,
  ICommand,
  IStrokePoint,
  IStrokeData
}
