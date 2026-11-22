import { expect, test } from "bun:test"
import { extractJson } from "./service"

test("extractJson reads fenced or embedded JSON", () => {
  expect(extractJson('Sure!\n```json\n{"a":1}\n```')).toEqual({ a: 1 })
  expect(extractJson('Here: {"profiles":[]} done')).toEqual({ profiles: [] })
})
