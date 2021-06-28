import React, { useLayoutEffect, useEffect, useRef } from "react";
import { OrgComponent } from "@ui_types";
import { Link } from "react-router-dom";
import { style } from "typestyle";
import * as R from "ramda";

type Tab = {
  label?: string;
  permitted: () => boolean;
  path: string;
  hidden?: true;
};

type Props = {
  tabs: Tab[];
  className?: string;
} & (
  | {
      redirectFromBasePath?: undefined;
      basePathTest?: undefined;
    }
  | {
      redirectFromBasePath: true;
      basePathTest: () => boolean;
    }
);

export const Tabs: OrgComponent<{}, Props> = (props) => {
  const permittedTabs = props.tabs.filter(({ permitted }) => permitted());
  const permittedPaths = permittedTabs.map(R.prop("path"));
  const ref = useRef<HTMLDivElement>(null);

  const shouldRedirectFromBase =
    props.redirectFromBasePath && props.basePathTest();

  useLayoutEffect(() => {
    if (shouldRedirectFromBase) {
      props.history.replace(props.location.pathname + permittedTabs[0].path);
    }
  }, [shouldRedirectFromBase]);

  useLayoutEffect(() => {
    if (
      !shouldRedirectFromBase &&
      !permittedPaths.find((path) => props.location.pathname.includes(path))
    ) {
      props.history.replace(props.match.url + permittedTabs[0].path);
    }
  }, [props.location.pathname, JSON.stringify(permittedPaths)]);

  return permittedTabs.length > 1 ? (
    <div className={props.className} ref={ref}>
      {permittedTabs.map((tab, i) => {
        return tab.hidden ? (
          ""
        ) : (
          <Link
            className={
              props.location.pathname.includes(tab.path) ? "selected" : ""
            }
            to={props.match.url + tab.path}
            key={i}
          >
            <label>{tab.label}</label>
          </Link>
        );
      })}
    </div>
  ) : (
    <div />
  );
};
