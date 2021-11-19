const Router = require("@koa/router")
const tableController = require("../controllers/table")
const authorized = require("../../middleware/authorized")
const { paramResource, bodyResource } = require("../../middleware/resourceId")
const {
  BUILDER,
  PermissionLevels,
  PermissionTypes,
} = require("@budibase/auth/permissions")
const joiValidator = require("../../middleware/joi-validator")
const Joi = require("joi")

const router = Router()

function generateSaveValidator() {
  // prettier-ignore
  return joiValidator.body(Joi.object({
    _id: Joi.string(),
    _rev: Joi.string(),
    type: Joi.string().valid("table", "internal", "external"),
    primaryDisplay: Joi.string(),
    schema: Joi.object().required(),
    name: Joi.string().required(),
    views: Joi.object(),
    dataImport: Joi.object(),
  }).unknown(true))
}

router
  .get("/api/tables", authorized(BUILDER), tableController.fetch)
  .get(
    "/api/tables/:id",
    paramResource("id"),
    authorized(PermissionTypes.TABLE, PermissionLevels.READ),
    tableController.find
  )
  .post(
    "/api/tables",
    // allows control over updating a table
    bodyResource("_id"),
    authorized(BUILDER),
    generateSaveValidator(),
    tableController.save
  )
  .post(
    "/api/tables/csv/validate",
    authorized(BUILDER),
    tableController.validateCSVSchema
  )
  .delete(
    "/api/tables/:tableId/:revId",
    paramResource("tableId"),
    authorized(BUILDER),
    tableController.destroy
  )
  // this is currently builder only, but in the future
  // it could be carried out by an end user in app,
  // however some thought will need to be had about
  // implications for automations (triggers)
  // new trigger type, bulk rows created
  .post(
    "/api/tables/:tableId/import",
    paramResource("tableId"),
    authorized(BUILDER),
    tableController.bulkImport
  )

module.exports = router
