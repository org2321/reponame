import { Graph } from "../../types";
import * as R from "ramda";
import memoize from "../../lib/utils/memoize";
import {
  getGroupMembershipsByObjectId,
  getAppUserGroupsByComposite,
  getAppGroupUsersByComposite,
  getAppGroupUserGroupsByComposite,
} from "./indexed_graph";

export const getAppUserGroupAssoc = memoize(
  (graph: Graph.Graph, appId: string, userId: string) => {
    const userGroupIds = (
        getGroupMembershipsByObjectId(graph)[userId] || []
      ).map(R.prop("groupId")),
      appUserGroup = userGroupIds
        .map(
          (userGroupId) =>
            getAppUserGroupsByComposite(graph)[[appId, userGroupId].join("|")]
        )
        .filter(Boolean)[0];
    if (appUserGroup) {
      return appUserGroup;
    }

    const appGroupIds = (getGroupMembershipsByObjectId(graph)[appId] || []).map(
        R.prop("groupId")
      ),
      appGroupUser = appGroupIds
        .map(
          (appGroupId) =>
            getAppGroupUsersByComposite(graph)[[appGroupId, userId].join("|")]
        )
        .filter(Boolean)[0];

    if (appGroupUser) {
      return appGroupUser;
    }

    const appGroupUserGroup = R.flatten(
      userGroupIds.map((userGroupId) =>
        appGroupIds.map(
          (appGroupId) =>
            getAppGroupUserGroupsByComposite(graph)[
              [appGroupId, userGroupId].join("|")
            ]
        )
      )
    ).filter(Boolean)[0];

    if (appGroupUserGroup) {
      return appGroupUserGroup;
    }
  }
);
