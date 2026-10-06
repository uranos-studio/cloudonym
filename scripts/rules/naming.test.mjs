import { test } from 'node:test';
import assert from 'node:assert/strict';
import { typeWords, typeSnake, hasSingleLetterToken, abbreviateSnake } from './naming.mjs';

test('typeWords — 섞인 약어를 한 낱말로', () => {
  assert.deepEqual(typeWords('IPv4Pool'), ['IPv4', 'Pool']);
  assert.deepEqual(typeWords('IoTApps'), ['IoT', 'Apps']);
  assert.equal(typeSnake('IoTCentral'), 'iot_central');
  assert.equal(typeSnake('IoTApps'), 'iot_apps');
  assert.equal(typeSnake('signalR'), 'signalr');
  assert.equal(typeSnake('SignalRService'), 'signalr_service');
  assert.equal(typeSnake('LocalGatewayRouteTableVPCAssociation'), 'local_gateway_route_table_vpc_association');
  assert.equal(typeSnake('OIDCProvider'), 'oidc_provider');
  assert.equal(typeSnake('DBClusterParameterGroup'), 'db_cluster_parameter_group');
});

test('한 글자 토막 판정', () => {
  for (const t of ['io_t_central', 'ec2_i_pv4_pool', 'n_nh_rules', 'a_b']) assert.ok(hasSingleLetterToken(t), t);
  for (const t of ['ec2_ipv4_pool', 'iot_central_iot_apps', 'am_service', 'ec2']) assert.ok(!hasSingleLetterToken(t), t);
});

test('낱말 약어', () => {
  assert.equal(abbreviateSnake('ec2_ipam_external_resource_verification_token'), 'ec2_ipam_ext_resource_verif_token');
});
