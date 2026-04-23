/**
 * openapi-spec.ts — OpenAPI 3.0 spec object for public API v1 endpoints.
 * Describes all /api/external/v1/* routes and X-API-Key auth scheme.
 * Consumed by GET /api/external/v1/docs and @fastify/swagger.
 */

export const openapiSpec = {
  openapi: '3.0.3',
  info: {
    title: 'ZaloCRM Public API',
    version: '1.0.0',
    description:
      'External REST API for ZaloCRM. Authenticate with X-API-Key header. ' +
      'Keys are managed in the CRM admin panel (Settings → API Keys).',
  },
  servers: [{ url: '/api/external/v1', description: 'Public API v1' }],
  components: {
    securitySchemes: {
      apiKey: {
        type: 'apiKey',
        in: 'header',
        name: 'X-API-Key',
        description: 'API key prefixed with zcrm_',
      },
    },
    schemas: {
      Error: {
        type: 'object',
        properties: {
          error: {
            type: 'object',
            properties: {
              code: { type: 'string' },
              message: { type: 'string' },
              details: { type: 'object' },
            },
            required: ['code', 'message'],
          },
        },
      },
      Pagination: {
        type: 'object',
        properties: {
          page: { type: 'integer' },
          limit: { type: 'integer' },
          total: { type: 'integer' },
        },
      },
      Contact: {
        type: 'object',
        properties: {
          crm_name: { type: 'string' },
          phone: { type: 'string' },
          email: { type: 'string' },
          status: { type: 'string' },
          tags: { type: 'array', items: { type: 'string' } },
          createdAt: { type: 'string', format: 'date-time' },
          lastMessageAt: { type: 'string', format: 'date-time' },
          avatarUrl: { type: 'string' },
          custom: { type: 'object', additionalProperties: true },
        },
      },
      AttrDef: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          key: { type: 'string' },
          label: { type: 'string' },
          dataType: { type: 'string', enum: ['string', 'number', 'date', 'boolean', 'enum'] },
          enumValues: { type: 'array', items: { type: 'string' }, nullable: true },
          required: { type: 'boolean' },
        },
      },
    },
  },
  security: [{ apiKey: [] }],
  paths: {
    '/contacts': {
      get: {
        summary: 'List contacts',
        operationId: 'listContacts',
        tags: ['Contacts'],
        parameters: [
          { name: 'phone', in: 'query', schema: { type: 'string' } },
          { name: 'tag', in: 'query', schema: { type: 'string' } },
          { name: 'status', in: 'query', schema: { type: 'string' } },
          { name: 'page', in: 'query', schema: { type: 'integer', default: 1 } },
          { name: 'limit', in: 'query', schema: { type: 'integer', default: 20, maximum: 100 } },
        ],
        responses: {
          '200': {
            description: 'Contact list',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    data: { type: 'array', items: { $ref: '#/components/schemas/Contact' } },
                    pagination: { $ref: '#/components/schemas/Pagination' },
                  },
                },
              },
            },
          },
          '401': { description: 'Unauthorized', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } },
        },
      },
      post: {
        summary: 'Create contact',
        operationId: 'createContact',
        tags: ['Contacts'],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  fullName: { type: 'string' },
                  phone: { type: 'string' },
                  email: { type: 'string' },
                  status: { type: 'string' },
                  tags: { type: 'array', items: { type: 'string' } },
                  customAttrs: { type: 'object', additionalProperties: true },
                },
              },
            },
          },
        },
        responses: {
          '201': { description: 'Created contact' },
          '400': { description: 'Validation error', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } },
          '401': { description: 'Unauthorized' },
          '403': { description: 'Insufficient scope' },
        },
      },
    },
    '/contacts/{id}': {
      get: {
        summary: 'Get contact by ID',
        operationId: 'getContact',
        tags: ['Contacts'],
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        responses: {
          '200': { description: 'Contact detail', content: { 'application/json': { schema: { type: 'object', properties: { data: { $ref: '#/components/schemas/Contact' } } } } } },
          '401': { description: 'Unauthorized' },
          '404': { description: 'Not found' },
        },
      },
      patch: {
        summary: 'Update contact',
        operationId: 'updateContact',
        tags: ['Contacts'],
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  fullName: { type: 'string' },
                  phone: { type: 'string' },
                  email: { type: 'string' },
                  status: { type: 'string' },
                  tags: { type: 'array', items: { type: 'string' } },
                  customAttrs: { type: 'object', additionalProperties: true },
                },
              },
            },
          },
        },
        responses: {
          '200': { description: 'Updated contact' },
          '400': { description: 'Validation error' },
          '401': { description: 'Unauthorized' },
          '403': { description: 'Insufficient scope' },
          '404': { description: 'Not found' },
        },
      },
    },
    '/contacts/{id}/messages': {
      post: {
        summary: 'Send text message to contact',
        operationId: 'sendMessage',
        tags: ['Contacts'],
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['text'],
                properties: {
                  text: { type: 'string', description: 'Message text to send' },
                },
              },
            },
          },
        },
        responses: {
          '200': { description: 'Message sent' },
          '400': { description: 'Validation error or no active conversation' },
          '401': { description: 'Unauthorized' },
          '403': { description: 'Insufficient scope' },
          '404': { description: 'Contact not found' },
        },
      },
    },
    '/custom-attrs': {
      get: {
        summary: 'List custom attribute definitions',
        operationId: 'listCustomAttrs',
        tags: ['Schema'],
        responses: {
          '200': {
            description: 'Attribute definitions',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: { data: { type: 'array', items: { $ref: '#/components/schemas/AttrDef' } } },
                },
              },
            },
          },
          '401': { description: 'Unauthorized' },
        },
      },
    },
  },
};
