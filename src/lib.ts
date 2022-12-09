import { emit, on, once } from "@create-figma-plugin/utilities"

let lastCallerId = 0
let lastSubscriptionId = 0
export function callMain(fnName: string, ...args: any[]) {
  lastCallerId += 1
  const callerId = lastCallerId

  args = args.map((arg) => checkForCallbacks(fnName, callerId, arg))

  return new Promise<any>(function (resolve) {
    once(`RES_${fnName}_${callerId}`, (returnValue) => {
      resolve(returnValue)

      // cleanup subscriptions
      const unsubscribes = subscriptions.get(getSubscriptionStringPrefix(fnName, callerId))
      unsubscribes?.forEach((unsubscribe) => unsubscribe())
      subscriptions.set(getSubscriptionStringPrefix(fnName, callerId), [])
    })
    emit(`REQ_${fnName}`, callerId, ...args)
  })
}

const subscriptions = new Map<string, Function[]>()
function checkForCallbacks(fnName: string, callerId: number, arg: any) {
  if (typeof arg === "object") {
    return {
      ...Object.keys(arg).reduce((acc, key) => {
        acc[key] = checkForCallbacks(fnName, callerId, arg[key])
        return acc
      }, {} as any)
    }
  }
  if (typeof arg !== "function") return arg

  const callback = arg as Function
  lastSubscriptionId += 1
  const subscriptionId = lastSubscriptionId
  const unsubscribe = on(
    getSubscriptionString(fnName, callerId, subscriptionId),
    (subscriptionId: number, ...args: any[]) => {
      // call original callback
      callback(...args)
    }
  )
  const prevSubscriptions = subscriptions.get(getSubscriptionStringPrefix(fnName, callerId)) || []
  subscriptions.set(getSubscriptionStringPrefix(fnName, callerId), [
    ...prevSubscriptions,
    unsubscribe
  ])

  return { subscriptionId, fnName: arg.name, __SUBSCRIPTION__: true }
}

function getSubscriptionString(fnName: string, callerId: number, subscriptionId: number): string {
  return `${getSubscriptionStringPrefix(fnName, callerId)}_${subscriptionId}`
}

function getSubscriptionStringPrefix(fnName: string, callerId: number): string {
  return `SUB_${fnName}_${callerId}`
}

export function exposeToUI(fn: (...args: any[]) => any) {
  const name = fn.name
  on(`REQ_${name}`, async (callerId: number, ...reqArgs: any[]) => {
    reqArgs = reqArgs.map((arg) => checkForSubscriptions(name, callerId, arg))
    const returnValue = await fn(...reqArgs)
    emit(`RES_${name}_${callerId}`, returnValue)
  })
}

function checkForSubscriptions(fnName: string, callerId: number, arg: any) {
  if (typeof arg === "object" && !arg.__SUBSCRIPTION__) {
    return {
      ...Object.keys(arg).reduce((acc, key) => {
        acc[key] = checkForSubscriptions(fnName, callerId, arg[key])
        return acc
      }, {} as any)
    }
  }
  if (typeof arg !== "object" || !arg.__SUBSCRIPTION__) return arg

  const { subscriptionId } = arg
  return (...args: any[]) => {
    emit(getSubscriptionString(fnName, callerId, subscriptionId), subscriptionId, ...args)
  }
}

export function exposeAllToUI(actions: any) {
  Object.keys(actions).map((actionName: string) => exposeToUI((actions as any)[actionName]))
}

export type AsyncActionType<F extends (...args: any) => any> = F
export type SyncActionType<F extends (...args: any) => any> = (
  ...args: Parameters<F>
) => Promise<ReturnType<F>>
