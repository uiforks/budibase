const CouchDB = require("../../db")
const { generateWebhookID, getWebhookParams } = require("../../db/utils")
const toJsonSchema = require("to-json-schema")
const validate = require("jsonschema").validate
const triggers = require("../../automations/triggers")
const { getDeployedAppID } = require("@budibase/auth/db")

const AUTOMATION_DESCRIPTION = "Generated from Webhook Schema"

function Webhook(name, type, target) {
  this.live = true
  this.name = name
  this.action = {
    type,
    target,
  }
}

exports.Webhook = Webhook

exports.WebhookType = {
  AUTOMATION: "automation",
}

exports.fetch = async ctx => {
  const db = new CouchDB(ctx.appId)
  const response = await db.allDocs(
    getWebhookParams(null, {
      include_docs: true,
    })
  )
  ctx.body = response.rows.map(row => row.doc)
}

exports.save = async ctx => {
  const db = new CouchDB(ctx.appId)
  const webhook = ctx.request.body
  webhook.appId = ctx.appId

  // check that the webhook exists
  if (webhook._id) {
    await db.get(webhook._id)
  } else {
    webhook._id = generateWebhookID()
  }
  const response = await db.put(webhook)
  webhook._rev = response.rev
  ctx.body = {
    message: "Webhook created successfully",
    webhook,
  }
}

exports.destroy = async ctx => {
  const db = new CouchDB(ctx.appId)
  ctx.body = await db.remove(ctx.params.id, ctx.params.rev)
}

exports.buildSchema = async ctx => {
  const db = new CouchDB(ctx.params.instance)
  const webhook = await db.get(ctx.params.id)
  webhook.bodySchema = toJsonSchema(ctx.request.body)
  // update the automation outputs
  if (webhook.action.type === exports.WebhookType.AUTOMATION) {
    let automation = await db.get(webhook.action.target)
    const autoOutputs = automation.definition.trigger.schema.outputs
    let properties = webhook.bodySchema.properties
    for (let prop of Object.keys(properties)) {
      autoOutputs.properties[prop] = {
        type: properties[prop].type,
        description: AUTOMATION_DESCRIPTION,
      }
    }
    await db.put(automation)
  }
  ctx.body = await db.put(webhook)
}

exports.trigger = async ctx => {
  const prodAppId = getDeployedAppID(ctx.params.instance)
  try {
    const db = new CouchDB(prodAppId)
    const webhook = await db.get(ctx.params.id)
    // validate against the schema
    if (webhook.bodySchema) {
      validate(ctx.request.body, webhook.bodySchema)
    }
    const target = await db.get(webhook.action.target)
    if (webhook.action.type === exports.WebhookType.AUTOMATION) {
      // trigger with both the pure request and then expand it
      // incase the user has produced a schema to bind to
      await triggers.externalTrigger(target, {
        body: ctx.request.body,
        ...ctx.request.body,
        appId: prodAppId,
      })
    }
    ctx.status = 200
    ctx.body = {
      message: "Webhook trigger fired successfully",
    }
  } catch (err) {
    if (err.status === 404) {
      ctx.status = 200
      ctx.body = {
        message: "Application not deployed yet.",
      }
    }
  }
}
