const Router = require("@koa/router")
const queryController = require("../controllers/query")
const authorized = require("../../middleware/authorized")
const Joi = require("joi")
const {
  PermissionLevels,
  PermissionTypes,
  BUILDER,
} = require("@budibase/auth/permissions")
const joiValidator = require("../../middleware/joi-validator")
const {
  bodyResource,
  bodySubResource,
  paramResource,
} = require("../../middleware/resourceId")

const router = Router()

function generateQueryValidation() {
  // prettier-ignore
  return joiValidator.body(Joi.object({
    _id: Joi.string(),
    _rev: Joi.string(),
    name: Joi.string().required(),
    fields: Joi.object().required(),
    datasourceId: Joi.string().required(),
    readable: Joi.boolean(),
    parameters: Joi.array().items(Joi.object({
      name: Joi.string(),
      default: Joi.string().allow(""),
    })),
    queryVerb: Joi.string().allow().required(),
    extra: Joi.object().optional(),
    schema: Joi.object({}).required().unknown(true),
    transformer: Joi.string().optional(),
  }))
}

function generateQueryPreviewValidation() {
  // prettier-ignore
  return joiValidator.body(Joi.object({
    fields: Joi.object().required(),
    queryVerb: Joi.string().allow().required(),
    extra: Joi.object().optional(),
    datasourceId: Joi.string().required(),
    transformer: Joi.string().optional(),
    parameters: Joi.object({}).required().unknown(true)
  }))
}

router
  .get("/api/queries", authorized(BUILDER), queryController.fetch)
  .post(
    "/api/queries",
    bodySubResource("datasourceId", "_id"),
    authorized(BUILDER),
    generateQueryValidation(),
    queryController.save
  )
  .post(
    "/api/queries/preview",
    bodyResource("datasourceId"),
    authorized(BUILDER),
    generateQueryPreviewValidation(),
    queryController.preview
  )
  .get(
    "/api/queries/:queryId",
    paramResource("queryId"),
    authorized(PermissionTypes.QUERY, PermissionLevels.READ),
    queryController.find
  )
  .post(
    "/api/queries/:queryId",
    paramResource("queryId"),
    authorized(PermissionTypes.QUERY, PermissionLevels.WRITE),
    queryController.execute
  )
  .delete(
    "/api/queries/:queryId/:revId",
    paramResource("queryId"),
    authorized(BUILDER),
    queryController.destroy
  )

module.exports = router
