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
      const unsubscribes = subscriptions.get(getSubscriptionStringPrefix(fnName, callerId))
      unsubscribes?.forEach((unsubscribe) => unsubscribe())
      subscriptions.set(getSubscriptionStringPrefix(fnName, callerId), [])
      console.log("[ui] cleaned up subscriptions", unsubscribes?.length)
    })
    emit(`REQ_${fnName}`, callerId, ...args)
  })
}

const subscriptions = new Map<string, Function[]>()
function checkForCallbacks(fnName: string, callerId: number, arg: any) {
  if (typeof arg === "object") {
    console.log("[ui] found object with that is an argument", arg)
    return {
      ...Object.keys(arg).reduce((acc, key) => {
        acc[key] = checkForCallbacks(fnName, callerId, arg[key])
        return acc
      }, {} as any)
    }
  }
  if (typeof arg !== "function") return arg

  const callback = arg as Function
  console.log("[ui] found function with that is an argument")
  lastSubscriptionId += 1
  const subscriptionId = lastSubscriptionId
  const unsubscribe = on(
    getSubscriptionString(fnName, callerId, subscriptionId),
    (subscriptionId: number, ...args: any[]) => {
      // call original callback
      console.log("[ui] received subscription callback", fnName, subscriptionId, args)
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
  console.log("[main] exposing", name)
  on(`REQ_${name}`, async (callerId: number, ...reqArgs: any[]) => {
    console.log("[main] received call", name, callerId, reqArgs)
    reqArgs = reqArgs.map((arg) => checkForSubscriptions(name, callerId, arg))
    const returnValue = await fn(...reqArgs)
    emit(`RES_${name}_${callerId}`, returnValue)
  })
}

function checkForSubscriptions(fnName: string, callerId: number, arg: any) {
  if (typeof arg === "object" && !arg.__SUBSCRIPTION__) {
    console.log("[main] found object with that is an argument", arg)
    return {
      ...Object.keys(arg).reduce((acc, key) => {
        acc[key] = checkForSubscriptions(fnName, callerId, arg[key])
        return acc
      }, {} as any)
    }
  }
  if (typeof arg !== "object" || !arg.__SUBSCRIPTION__) return arg

  console.log("[main] found subscription... processing...", arg)

  const { subscriptionId } = arg
  return (...args: any[]) => {
    console.log("[main] emitting subscription", fnName, subscriptionId, args)
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
